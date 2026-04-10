/**
 * Work Dispatcher for schedule-driven work nodes.
 *
 * For the thread-monitor steer node:
 * 1. Reads the thread's conversation state directly from the DB
 * 2. Calls the provider directly via runCliResponse (same as chat endpoint)
 * 3. Parses structured output: { isDone: boolean, message: string }
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import type { WorkNode, ExecutionGraph } from './types';
import type { WorkDispatchResult } from './executor';
import type { ChatProvider } from '@/lib/types';

const ACTIVE_PROCESS_STATUSES = new Set(['running', 'working']);
const DEFAULT_STEER_DIRECTIVE = `Review the thread, assess whether the work is complete enough to move into review, and if not, produce one concise steering message that combines:
1. what has been accomplished vs. what remains
2. the concrete next steps needed to move toward shipping`;
const STEER_OUTPUT_CONTRACT = `You MUST respond with ONLY a JSON object, no markdown fences, no extra text:
{"isDone": true/false, "message": "your assessment"}

Set isDone=true only when the thread is genuinely ready to stop ship mode and move into review.
If isDone=false, message must be a single concise steering note with both status and next steps.
The message must not be empty.`;

/**
 * Read agx config to get the default provider name.
 */
function getDefaultProvider(): string {
  try {
    const configPath = join(homedir(), '.agx', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    return config.defaultProvider ?? 'claude';
  } catch {
    return 'claude';
  }
}

function resolveProvider(raw: string): ChatProvider {
  switch (raw) {
    case 'claude':
    case 'gemini':
    case 'ollama':
    case 'codex':
    case 'zai':
      return raw;
    default:
      return 'claude';
  }
}

/**
 * Resolve the first agent from a team if the task's frontmatter has a `team` field.
 * Returns the agent_id or null if no team match is found.
 */
function resolveTeamAgent(
  sqlite: ReturnType<typeof import('@/lib/sqlite-query-adapter').getSQLiteDb>,
  projectId: string,
  taskId: string | undefined,
): string | null {
  if (!taskId) return null;
  try {
    const { parseFrontmatter } = require('@/lib/db') as typeof import('@/lib/db');
    const taskRow = sqlite
      .prepare('SELECT content FROM tasks WHERE id = ? LIMIT 1')
      .get(taskId) as { content: string } | undefined;
    if (!taskRow?.content) return null;

    const { frontmatter } = parseFrontmatter(taskRow.content);
    const teamName = typeof frontmatter.team === 'string' ? frontmatter.team.trim() : '';
    if (!teamName) return null;

    const teamRow = sqlite
      .prepare('SELECT id FROM teams WHERE project_id = ? AND name = ? LIMIT 1')
      .get(projectId, teamName) as { id: string } | undefined;
    if (!teamRow?.id) return null;

    const agentRow = sqlite
      .prepare('SELECT agent_id FROM team_agents WHERE team_id = ? ORDER BY routing_order ASC LIMIT 1')
      .get(teamRow.id) as { agent_id: string } | undefined;
    return agentRow?.agent_id ?? null;
  } catch {
    return null;
  }
}

async function getSteeringAgentConfig(
  threadId: string,
  taskId?: string,
): Promise<{ provider: ChatProvider; model: string | null }> {
  try {
    const [{ getSQLiteDb }, { loadDbParticipants }] = await Promise.all([
      import('@/lib/sqlite-query-adapter'),
      import('@/lib/agent-participants'),
    ]);
    const sqlite = getSQLiteDb();
    const projectRow = sqlite
      .prepare(
        `SELECT pt.project_id AS project_id
         FROM project_threads pt
         WHERE pt.thread_id = ?
         ORDER BY pt.created_at ASC
         LIMIT 1`
      )
      .get(threadId) as { project_id: string } | undefined;
    if (!projectRow?.project_id) {
      return { provider: resolveProvider(getDefaultProvider()), model: null };
    }

    // Try team-based agent resolution first
    const teamAgentId = resolveTeamAgent(sqlite, projectRow.project_id, taskId);

    const agentId = teamAgentId ?? (sqlite
      .prepare(
        `SELECT agent_id
         FROM project_agents
         WHERE project_id = ?
         ORDER BY routing_order ASC, created_at ASC
         LIMIT 1`
      )
      .get(projectRow.project_id) as { agent_id: string } | undefined)?.agent_id;

    if (!agentId) {
      return { provider: resolveProvider(getDefaultProvider()), model: null };
    }

    const participants = await loadDbParticipants();
    const agent = participants.find((participant) => participant.id === agentId);
    if (!agent) {
      return { provider: resolveProvider(getDefaultProvider()), model: null };
    }

    return {
      provider: resolveProvider(agent.provider),
      model: agent.model,
    };
  } catch {
    return { provider: resolveProvider(getDefaultProvider()), model: null };
  }
}

function buildSteerSystemPrompt(node: WorkNode): string {
  const steerDirective = node.description?.trim() || DEFAULT_STEER_DIRECTIVE;
  return `${steerDirective}\n\n${STEER_OUTPUT_CONTRACT}`;
}

/**
 * Create a dispatchWork implementation for schedule-driven graphs.
 *
 * Reads thread status from DB, calls provider directly via runCliResponse, returns structured result.
 */
export function createDispatchWork(): (
  node: WorkNode,
  graph: ExecutionGraph,
) => Promise<WorkDispatchResult> {
  return async (node, graph) => {
    const rootMessageId = graph.schedule?.rootMessageId;
    if (!rootMessageId) {
      return {
        status: 'failure' as const,
        message: 'No rootMessageId on graph schedule',
      };
    }

    console.log(
      `[work-dispatch] Dispatching steer node "${node.title}" for graph ${graph.id} (root: ${rootMessageId})`,
    );

    try {
      // 1. Read thread status directly from DB
      const { getMessageThread, getThreadStatusSnapshot, sweepStaleWorkingReactions } =
        await import('@/lib/history-store');

      const threadRef = await getMessageThread(rootMessageId);
      if (!threadRef) {
        return {
          status: 'failure' as const,
          message: `Thread not found for rootMessageId: ${rootMessageId}`,
        };
      }

      await sweepStaleWorkingReactions(threadRef.threadId);
      const snapshot = await getThreadStatusSnapshot({
        threadId: threadRef.threadId,
        rootMessageId,
      });

      const activeProcessCount = snapshot.processes.filter(
        (p: { status: string }) => ACTIVE_PROCESS_STATUSES.has(p.status),
      ).length;
      const rootStatus = snapshot.rootMessage?.threadStatus ?? 'active';
      const processSummary = snapshot.processes
        .slice(0, 8)
        .map((process: {
          agent: string;
          status: string;
          responseTo?: string;
          responseContent?: string | null;
        }) => {
          const details = [`${process.agent}: ${process.status}`];
          if (process.responseTo) details.push(`replying to "${process.responseTo.slice(0, 140)}"`);
          if (process.responseContent) details.push(`latest response "${process.responseContent.slice(0, 140)}"`);
          return `- ${details.join(' | ')}`;
        })
        .join('\n');

      // Build a summary of recent messages for context
      const recentMessages = (snapshot.messages ?? [])
        .slice(-15)
        .map((m: { role?: string; content?: string; participantId?: string | null }) => {
          const sender = m.participantId ?? m.role ?? '?';
          const text = (m.content ?? '').slice(0, 600);
          return `[${sender}]: ${text}`;
        })
        .join('\n');

      console.log(`[work-dispatch] Thread: active=${activeProcessCount}, msgs=${snapshot.messages?.length ?? 0}`);

      // 2. Build assessment prompt
      const assessPrompt = [
        '--- THREAD STATE ---',
        `Root request: ${snapshot.rootMessage?.content ?? '(missing root message)'}`,
        `Thread status: ${rootStatus}`,
        `Active agents: ${activeProcessCount}`,
        `Total messages: ${snapshot.messages?.length ?? 0}`,
        snapshot.lastUpdatedAt ? `Last updated at: ${new Date(snapshot.lastUpdatedAt).toISOString()}` : null,
        '',
        'Current process state:',
        processSummary || '- none',
        '',
        'Recent messages:',
        recentMessages || '- none',
        '--- END THREAD STATE ---',
        '',
        'Assess the progress and respond with the JSON object.',
      ]
        .filter(Boolean)
        .join('\n');

      // 3. Call provider directly via runCliResponse (same path as chat endpoint)
      const { runCliResponse } = await import('@/lib/cli-runner');
      const steeringAgent = await getSteeringAgentConfig(threadRef.threadId, graph.taskId);
      console.log(
        `[work-dispatch] Calling ${steeringAgent.provider} via runCliResponse (prompt length: ${assessPrompt.length})...`
      );

      let fullResponse = '';
      await runCliResponse({
        provider: steeringAgent.provider,
        model: steeringAgent.model,
        prompt: assessPrompt,
        systemContext: buildSteerSystemPrompt(node),
        onDelta: (chunk: string) => {
          fullResponse += chunk;
        },
        onLog: (stream, line) => {
          console.log(`[work-dispatch] [${stream}] ${line}`);
        },
      });

      console.log(`[work-dispatch] Raw response: ${fullResponse.slice(0, 500)}`);

      // 4. Parse structured output
      const parsed = parseSteerResponse(fullResponse.trim());
      if (!parsed.ok) {
        return {
          status: 'failure' as const,
          transient: false,
          message: parsed.error,
        };
      }
      console.log(`[work-dispatch] Parsed result:`, parsed);

      return {
        status: 'success' as const,
        output: parsed.value,
      };
    } catch (err) {
      console.error(`[work-dispatch] Steer dispatch failed:`, err);
      return {
        status: 'failure' as const,
        message: err instanceof Error ? err.message : String(err),
        error: err,
      };
    }
  };
}

/**
 * Parse the steer agent's response into { isDone, message }.
 */
function parseSteerResponse(
  raw: string
):
  | { ok: true; value: { isDone: boolean; message: string } }
  | { ok: false; error: string } {
  const jsonMatch = raw.match(/\{[\s\S]*?"isDone"\s*:\s*(true|false)[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const message = String(parsed.message ?? '').trim();
      if (!message) {
        return { ok: false, error: 'Ship mode response JSON did not include a non-empty message.' };
      }
      return {
        ok: true,
        value: {
          isDone: Boolean(parsed.isDone),
          message,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    ok: false,
    error: 'Ship mode response was not valid JSON with isDone/message fields.',
  };
}
