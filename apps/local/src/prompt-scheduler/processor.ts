import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import { getPromptJobStore } from './get-store';
import { pollDueJobs } from './engine';
import { getAgent, getAgentSkills, getProjectAgents } from '@/lib/db';
import { LOCAL_USER } from '@/lib/auth-mode';
import { loadDbParticipants } from '@/lib/agent-participants';
import { runCliResponse, buildCliAttempts } from '@/lib/cli-runner';
import { startScriptedLinearSession } from '@/lib/linear-scripted-session';
import { getIssueActiveAgents } from '@/lib/linear-run-store';
import {
  filterObjectiveLinearIssuesForAction,
  isObjectiveLinearTerminalStatus,
  listObjectiveLinearIssues,
} from '@/lib/objective-linear-issues';
import {
  loadProjectObjectiveContext,
  persistProjectHealthSnapshot,
  persistProjectObjectiveWorkspace,
} from '@/lib/project-objective-context';
import {
  normalizeProjectHealthProgress,
  normalizeProjectHealthStatus,
  upsertProjectObjective,
  writeProjectHealthSnapshot,
  type ProjectHealthSnapshot,
  type ProjectObjectiveHealth,
} from '@/lib/project-objectives';
import { getActivityRepository } from '@/src/objectives/activities/repository';
import type { ChatProvider } from '@/lib/types';
import type { LinearIssueSummary } from '@/lib/linear-issues';
import type { Participant } from '@/lib/types';
import type { PromptJob, PromptRun } from './types';

let registeredPump: (() => Promise<void>) | null = null;
let pumpPending = false;
let pumpScheduled = false;
let pumpRunning = false;

const AGENTS_DIR = join(homedir(), '.agx', 'agents');
const OBJECTIVE_CONTROLLER_SYSTEM_CONTEXT = [
  'You are deciding what action an objective worker should take next.',
  'Return ONLY raw JSON with no markdown fences or commentary.',
  'Valid responses:',
  '{"action":"work_ticket","ticketId":"ticket-id-from-list","reason":"short reason","objectiveProgress":42,"objectiveStatus":"at_risk","projectProgress":35,"projectStatus":"at_risk"}',
  '{"action":"run_prompt","prompt":"detailed instructions for the agent to execute","reason":"short reason","objectiveProgress":42,"objectiveStatus":"at_risk","projectProgress":35,"projectStatus":"at_risk"}',
  '{"action":"stop","reason":"short reason","objectiveProgress":42,"objectiveStatus":"at_risk","projectProgress":35,"projectStatus":"at_risk"}',
  'Rules:',
  '- "work_ticket": Use when a specific eligible Linear ticket should be worked now. ticketId must exactly match one of the listed ids in ELIGIBLE TICKETS.',
  '- "run_prompt": Use when the objective needs work not captured by an existing ticket — creating new tickets, drafting docs, reviewing PRs, research, or other non-ticket work. Provide a detailed prompt.',
  '- "stop": Use when no action should be taken right now.',
  'Percentages must be integers from 0 to 100.',
  'Statuses must be one of: on_track, at_risk, off_track, done.',
].join('\n');

const HEALTH_LABELS: Record<ProjectObjectiveHealth, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
  done: 'Done',
};

/** Build a short command string for process identification (used by stale-run reaper). */
function buildHostCommand(provider: ChatProvider, model: string | null): string {
  const attempts = buildCliAttempts({ provider, model, prompt: '', systemPrompt: undefined });
  if (attempts.length > 0) {
    const { command, args } = attempts[0];
    // Store enough of the command to identify it — the binary + first few args
    return `${command} ${args.slice(0, 3).join(' ')}`;
  }
  return provider;
}

async function hydrateAgent(agentId: string): Promise<{
  provider: ChatProvider;
  model: string | null;
  identity: string | undefined;
  self: string | undefined;
  skills: string | undefined;
}> {
  const agent = await getAgent(agentId, LOCAL_USER.id);
  if (!agent) return { provider: 'claude', model: null, identity: undefined, self: undefined, skills: undefined };

  const agentDir = join(AGENTS_DIR, agentId);

  let identity: string | undefined;
  const parts: string[] = [];
  if (agent.name) parts.push(`Name: ${agent.name}`);
  if (agent.description) parts.push(agent.description);
  if (agent.voice) parts.push(`Voice: ${agent.voice}`);
  if (parts.length > 0) identity = parts.join('\n');

  let self: string | undefined;
  const selfPath = join(agentDir, 'self.md');
  if (existsSync(selfPath)) {
    const raw = readFileSync(selfPath, 'utf-8');
    const match = raw.match(/^---[\s\S]*?---\s*\n?([\s\S]*)$/);
    self = match ? match[1].trim() : raw.trim();
    if (!self) self = undefined;
  }

  let skills: string | undefined;
  const agentSkills = await getAgentSkills(agentId);
  if (agentSkills.length > 0) {
    const skillTexts: string[] = [];
    for (const skill of agentSkills) {
      const skillPath = skill.file.startsWith('/') ? skill.file : join(agentDir, skill.file);
      if (existsSync(skillPath)) {
        try {
          const content = readFileSync(skillPath, 'utf-8');
          skillTexts.push(`## ${skill.file}\n${content}`);
        } catch (err) {
          console.error('[prompt-jobs/processor] failed to read skill file:', err);
        }
      }
    }
    if (skillTexts.length > 0) skills = skillTexts.join('\n\n');
  }

  return {
    provider: (agent.provider || 'claude') as ChatProvider,
    model: agent.model || null,
    identity,
    self,
    skills,
  };
}

async function resolveJobContext(job: PromptJob): Promise<{
  provider: ChatProvider;
  model: string | null;
  identity: string | undefined;
  self: string | undefined;
  skills: string | undefined;
}> {
  return resolveJobContextForAgent(job, job.agentId);
}

async function resolveJobContextForAgent(job: PromptJob, agentId?: string | null): Promise<{
  provider: ChatProvider;
  model: string | null;
  identity: string | undefined;
  self: string | undefined;
  skills: string | undefined;
}> {
  if (agentId) {
    return hydrateAgent(agentId);
  }
  return {
    provider: (job.provider || 'claude') as ChatProvider,
    model: job.model || null,
    identity: undefined,
    self: undefined,
    skills: undefined,
  };
}

async function executePrompt(opts: {
  provider: ChatProvider;
  model: string | null;
  prompt: string;
  identity?: string;
  self?: string;
  skills?: string;
  systemContext?: string;
  cliArgs?: string;
  onSpawn?: (pid: number) => void;
}): Promise<{ output: string; error: string; durationMs: number; status: 'success' | 'failed' }> {
  const startMs = Date.now();
  let output = '';

  try {
    await runCliResponse({
      provider: opts.provider,
      model: opts.model,
      prompt: opts.prompt,
      identity: opts.identity,
      self: opts.self,
      skills: opts.skills,
      systemContext: opts.systemContext,
      passthroughArgs: opts.cliArgs ? opts.cliArgs.split(/\s+/).filter(Boolean) : undefined,
      onDelta: (chunk) => { output += chunk; },
      onSpawn: opts.onSpawn,
    });
    return { output, error: '', durationMs: Date.now() - startMs, status: 'success' };
  } catch (err) {
    return { output, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startMs, status: 'failed' };
  }
}

function extractFirstJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const directParse = tryParseJsonObject(trimmed);
  if (directParse) {
    return directParse;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }

  return tryParseJsonObject(trimmed.slice(start, end + 1));
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function formatIssueLine(issue: LinearIssueSummary): string {
  return [
    `- id: ${issue.id}`,
    `  identifier: ${issue.identifier}`,
    `  title: ${issue.title}`,
    `  status: ${issue.status}`,
    `  assignee: ${issue.assignee ?? 'Unassigned'}`,
    issue.url ? `  url: ${issue.url}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function formatObjectiveSummaryLine(input: {
  title: string;
  key: string;
  progress: number;
  status: ProjectObjectiveHealth;
}): string {
  return `- ${input.title} (${input.key}) | ${input.progress}% | ${input.status}`;
}

function formatHealthSummary(scope: string, progress: number, status: ProjectObjectiveHealth): string {
  return `${scope}: ${progress}% ${HEALTH_LABELS[status]}`;
}

function buildObjectiveLinearControllerPrompt(input: {
  jobPrompt: string;
  objective: {
    title: string;
    key: string;
    summary: string;
    progress: number;
    status: ProjectObjectiveHealth;
  };
  projectObjectives: Array<{
    title: string;
    key: string;
    progress: number;
    status: ProjectObjectiveHealth;
  }>;
  allIssues: LinearIssueSummary[];
  eligibleIssues: LinearIssueSummary[];
  activeIssueNotes: string[];
}): string {
  const sections = [
    'OBJECTIVE',
    `- Title: ${input.objective.title}`,
    `- Label key: ${input.objective.key}`,
    `- Summary: ${input.objective.summary.trim() || 'No summary provided.'}`,
    `- Current progress: ${input.objective.progress}%`,
    `- Current health: ${input.objective.status}`,
    '',
    'PROJECT OBJECTIVES',
    input.projectObjectives.length > 0
      ? input.projectObjectives.map((objective) => formatObjectiveSummaryLine(objective)).join('\n')
      : '- No project objectives found.',
    '',
    'ALL OBJECTIVE TICKETS',
    input.allIssues.length > 0
      ? input.allIssues.map((issue) => formatIssueLine(issue)).join('\n\n')
      : '- None.',
    '',
    'SCHEDULER GUIDANCE',
    input.jobPrompt.trim() || 'No additional guidance provided.',
    '',
    'ELIGIBLE TICKETS',
    input.eligibleIssues.length > 0
      ? input.eligibleIssues.map((issue) => formatIssueLine(issue)).join('\n\n')
      : '- None.',
  ];

  if (input.activeIssueNotes.length > 0) {
    sections.push('', 'ALREADY ACTIVE ELSEWHERE', input.activeIssueNotes.join('\n'));
  }

  sections.push(
    '',
    'Choose "work_ticket" when one listed ticket is clearly the right next ticket to start now.',
    'Choose "run_prompt" when the objective needs work not captured by an existing ticket (e.g. creating tickets, drafting docs, reviewing PRs).',
    'Choose "stop" when no action should be taken right now.',
    'If you choose "work_ticket", ticketId must exactly match one of the listed ids.',
    'If you choose "run_prompt", provide a detailed prompt the executing agent will follow.',
  );

  return sections.join('\n');
}

function normalizeAssessmentProgress(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return normalizeProjectHealthProgress(value);
}

function normalizeAssessmentStatus(value: unknown): ProjectObjectiveHealth | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  return normalizeProjectHealthStatus(value);
}

async function resolveObjectiveWorkerAgent(job: PromptJob): Promise<Participant> {
  const participants = await loadDbParticipants();

  if (job.agentId) {
    const assigned = participants.find((participant) => participant.id === job.agentId) ?? null;
    if (!assigned) {
      throw new Error(`Objective worker agent "${job.agentId}" is no longer available.`);
    }
    return assigned;
  }

  if (!job.projectId) {
    throw new Error('Objective Linear worker requires a project context to resolve an agent.');
  }

  const projectAgents = await getProjectAgents(job.projectId);
  for (const projectAgent of projectAgents) {
    const participant = participants.find((entry) => entry.id === projectAgent.agent_id) ?? null;
    if (participant) {
      return participant;
    }
  }

  throw new Error('No project agent is available to work objective Linear tickets.');
}

async function appendObjectiveWorkerActivity(input: {
  jobId: string;
  projectSlug: string;
  objectiveKey: string;
  body: string;
}): Promise<void> {
  getActivityRepository(input.projectSlug, input.objectiveKey).append({
    id: crypto.randomUUID(),
    source: `scheduled-task:${input.jobId}`,
    objectiveLabel: input.objectiveKey,
    createdAt: new Date().toISOString(),
    type: 'status-update',
    body: input.body,
  });
}

export async function logActionReceipt(
  receipt: import('./types').ActionReceipt,
  context: { jobId: string; projectId: string; objectiveId: string },
): Promise<void> {
  try {
    const objectiveContext = await loadProjectObjectiveContext(
      context.projectId,
      context.objectiveId,
    );
    if (!objectiveContext) return;

    const lines: string[] = [
      `**${receipt.jobName}** — ${receipt.status}`,
      '',
      receipt.result,
    ];
    if (receipt.reason) {
      lines.push('', `Reason: ${receipt.reason}`);
    }
    if (receipt.linearRunId) {
      lines.push('', `Linear run: ${receipt.linearRunId}`);
    }
    if (receipt.chatRunId) {
      lines.push('', `Chat run: ${receipt.chatRunId}`);
    }

    await appendObjectiveWorkerActivity({
      jobId: context.jobId,
      projectSlug: objectiveContext.project.slug,
      objectiveKey: objectiveContext.objective.key,
      body: lines.join('\n'),
    });
  } catch {
    // Activity logging is best-effort
  }
}

async function executeObjectiveLinearWorker(opts: {
  job: PromptJob;
  controllerContext: {
    provider: ChatProvider;
    model: string | null;
    identity: string | undefined;
    self: string | undefined;
    skills: string | undefined;
  };
  sessionAgent: Participant;
  cliArgs?: string;
  onSpawn?: (pid: number) => void;
}): Promise<{ output: string; error: string; durationMs: number; status: 'success' | 'failed' }> {
  const startMs = Date.now();

  try {
    if (!opts.job.projectId || !opts.job.objectiveId) {
      throw new Error('Objective Linear worker jobs require projectId and objectiveId.');
    }

    const objectiveContext = await loadProjectObjectiveContext(
      opts.job.projectId,
      opts.job.objectiveId,
    );
    if (!objectiveContext) {
      throw new Error('Objective context could not be resolved for this scheduled task.');
    }

    const [{ issues }, activeIssueAgents] = await Promise.all([
      listObjectiveLinearIssues({
        objectiveKey: objectiveContext.objective.key,
        projectSlug: objectiveContext.project.slug,
        refresh: true,
      }),
      getIssueActiveAgents(opts.job.projectId),
    ]);

    const objectiveIssueIds = new Set(issues.map((issue) => issue.id));
    const activeObjectiveAgents = activeIssueAgents.filter((entry) => objectiveIssueIds.has(entry.issueId));
    const activeIssueNotes = activeObjectiveAgents.map(
      (entry) => `- ${entry.issueId}: already running with ${entry.agentName}`,
    );
    const eligibleIssues = filterObjectiveLinearIssuesForAction(
      issues,
      activeObjectiveAgents.map((entry) => entry.issueId),
    );

    const controllerPrompt = buildObjectiveLinearControllerPrompt({
      jobPrompt: opts.job.prompt,
      objective: {
        title: objectiveContext.objective.title,
        key: objectiveContext.objective.key,
        summary: objectiveContext.objective.summary,
        progress: objectiveContext.objective.progress,
        status: objectiveContext.objective.status,
      },
      projectObjectives: objectiveContext.workspace.objectives.map((objective) => ({
        title: objective.title,
        key: objective.key,
        progress: objective.progress,
        status: objective.status,
      })),
      allIssues: issues,
      eligibleIssues,
      activeIssueNotes,
    });
    const controllerResult = await executePrompt({
      ...opts.controllerContext,
      prompt: controllerPrompt,
      systemContext: OBJECTIVE_CONTROLLER_SYSTEM_CONTEXT,
      cliArgs: opts.cliArgs,
      onSpawn: opts.onSpawn,
    });

    if (controllerResult.status !== 'success') {
      return {
        ...controllerResult,
        output: controllerResult.output || 'Objective controller failed before selecting a ticket.',
      };
    }

    const parsed = extractFirstJsonObject(controllerResult.output);
    const decision = typeof parsed?.decision === 'string' ? parsed.decision.trim().toLowerCase() : '';
    const reason = typeof parsed?.reason === 'string' ? parsed.reason.trim() : '';
    const objectiveProgress = normalizeAssessmentProgress(parsed?.objectiveProgress);
    const objectiveStatus = normalizeAssessmentStatus(parsed?.objectiveStatus);
    const projectProgress = normalizeAssessmentProgress(parsed?.projectProgress);
    const projectStatus = normalizeAssessmentStatus(parsed?.projectStatus);
    const projectNote = typeof parsed?.projectNote === 'string' ? parsed.projectNote.trim() : '';
    const objectiveNote = typeof parsed?.objectiveNote === 'string' ? parsed.objectiveNote.trim() : '';
    const nowIso = new Date().toISOString();

    const objectiveHealthSummary =
      objectiveProgress !== null && objectiveStatus
        ? formatHealthSummary('Objective health', objectiveProgress, objectiveStatus)
        : null;
    const projectHealthSummary =
      projectProgress !== null && projectStatus
        ? formatHealthSummary('Project health', projectProgress, projectStatus)
        : null;

    const objectiveChanged =
      objectiveProgress !== null &&
      objectiveStatus !== null &&
      (
        objectiveProgress !== objectiveContext.objective.progress ||
        objectiveStatus !== objectiveContext.objective.status
      );
    const nextWorkspace = objectiveChanged
      ? upsertProjectObjective(objectiveContext.workspace, {
          ...objectiveContext.objective,
          progress: objectiveProgress!,
          status: objectiveStatus!,
          updatedAt: nowIso,
        })
      : objectiveContext.workspace;
    const projectSnapshot: ProjectHealthSnapshot | null =
      projectProgress !== null && projectStatus !== null
        ? {
            progress: projectProgress,
            status: projectStatus,
            updatedAt: nowIso,
            source: `scheduled-task:${opts.job.id}`,
            objectiveId: objectiveContext.objective.id,
            objectiveKey: objectiveContext.objective.key,
            note: projectNote || undefined,
          }
        : null;

    if (objectiveChanged) {
      await persistProjectObjectiveWorkspace({
        projectId: objectiveContext.project.id,
        currentMetadata: objectiveContext.project.metadata,
        workspace: nextWorkspace,
        transformMetadata: (metadata) =>
          projectSnapshot ? writeProjectHealthSnapshot(metadata, projectSnapshot) : metadata,
      });
    } else if (projectSnapshot) {
      await persistProjectHealthSnapshot({
        projectId: objectiveContext.project.id,
        currentMetadata: objectiveContext.project.metadata,
        snapshot: projectSnapshot,
      });
    }

    if (decision === 'stop') {
      const hasNonTerminalIssues = issues.some((issue) => !isObjectiveLinearTerminalStatus(issue.status));
      const fallbackReason =
        issues.length === 0
          ? 'No objective-labeled Linear tickets were found.'
          : eligibleIssues.length === 0
            ? hasNonTerminalIssues
              ? 'All actionable objective tickets already have active sessions.'
              : 'All objective tickets are already in a terminal state.'
            : 'The controller decided that no ticket should be started right now.';
      const stopReason = reason || fallbackReason;
      await appendObjectiveWorkerActivity({
        jobId: opts.job.id,
        projectSlug: objectiveContext.project.slug,
        objectiveKey: objectiveContext.objective.key,
        body: [
          'No actionable objective tickets.',
          `Reason: ${stopReason}`,
          objectiveHealthSummary,
          objectiveNote || null,
          projectHealthSummary,
          projectNote || null,
        ]
          .filter((line): line is string => Boolean(line))
          .join('\n\n'),
      });
      return {
        output: [
          'No actionable objective tickets.',
          `Reason: ${stopReason}`,
          objectiveHealthSummary,
          projectHealthSummary,
        ]
          .filter((line): line is string => Boolean(line))
          .join('\n'),
        error: '',
        durationMs: Date.now() - startMs,
        status: 'success',
      };
    }

    if (decision !== 'work') {
      throw new Error(`Objective worker controller returned an invalid decision: ${controllerResult.output}`);
    }

    const ticketId = typeof parsed?.ticketId === 'string' ? parsed.ticketId.trim() : '';
    const selectedIssue = eligibleIssues.find((issue) => issue.id === ticketId) ?? null;
    if (!selectedIssue) {
      throw new Error(`Objective worker controller selected an unknown ticket: ${ticketId || '(empty)'}`);
    }

    const launch = await startScriptedLinearSession({
      projectId: objectiveContext.project.id,
      projectSlug: objectiveContext.project.slug,
      issue: {
        id: selectedIssue.id,
        identifier: selectedIssue.identifier,
        title: selectedIssue.title,
        status: selectedIssue.status,
        assignee: selectedIssue.assignee,
      },
      agentId: opts.sessionAgent.id,
    });

    const issueLink = selectedIssue.url
      ? `[${selectedIssue.identifier}](${selectedIssue.url})`
      : selectedIssue.identifier;
    await appendObjectiveWorkerActivity({
      jobId: opts.job.id,
      projectSlug: objectiveContext.project.slug,
      objectiveKey: objectiveContext.objective.key,
      body: [
        `Started work on ${issueLink}: ${selectedIssue.title}`,
        reason ? `Reason: ${reason}` : null,
        objectiveHealthSummary,
        objectiveNote || null,
        projectHealthSummary,
        projectNote || null,
        `Linear run: ${launch.run.id}`,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n\n'),
    });

    return {
      output: [
        `Started work on ${selectedIssue.identifier}: ${selectedIssue.title}`,
        reason ? `Reason: ${reason}` : null,
        objectiveHealthSummary,
        projectHealthSummary,
        `Linear run: ${launch.run.id}`,
        `Chat run: ${launch.chatRunId}`,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n'),
      error: '',
      durationMs: Date.now() - startMs,
      status: 'success',
    };
  } catch (err) {
    return {
      output: '',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
      status: 'failed',
    };
  }
}

async function executeJobAction(
  job: PromptJob,
  ctx: {
    provider: ChatProvider;
    model: string | null;
    identity: string | undefined;
    self: string | undefined;
    skills: string | undefined;
  },
  opts: {
    onSpawn?: (pid: number) => void;
  } = {},
): Promise<{ output: string; error: string; durationMs: number; status: 'success' | 'failed' }> {
  if (job.executionMode === 'objective_linear_ticket') {
    const sessionAgent = await resolveObjectiveWorkerAgent(job);
    const controllerContext = await resolveJobContextForAgent(job, sessionAgent.id);
    return executeObjectiveLinearWorker({
      job,
      controllerContext,
      sessionAgent,
      cliArgs: job.cliArgs,
      onSpawn: opts.onSpawn,
    });
  }

  return executePrompt({
    ...ctx,
    prompt: job.prompt,
    cliArgs: job.cliArgs,
    onSpawn: opts.onSpawn,
  });
}

async function fireConditionGate(job: PromptJob, run: PromptRun) {
  const store = getPromptJobStore();
  const startedAt = new Date().toISOString();
  const fallbackHostCommand = buildHostCommand(
    (job.provider || 'claude') as ChatProvider,
    job.model || null,
  );
  store.updateRun(run.id, { status: 'running', startedAt, hostCommand: fallbackHostCommand });
  const ctx = await resolveJobContext(job);
  const gatePrompt = `You are a condition gate. Your job is to determine whether the following condition expression evaluates to "yes" (pass) or "no" (fail).\n\nRules:\n- If the condition is a boolean literal or expression (e.g. "true", "return True", "1 == 1"), evaluate it as code and respond based on its result.\n- If the condition is a natural-language statement, judge whether it holds.\n- If the condition is an instruction (e.g. "say yes", "always pass"), follow it.\n- Respond with ONLY "yes" or "no" (lowercase, nothing else).\n\nCondition: ${job.condition}`;

  const hostCommand = buildHostCommand(ctx.provider, ctx.model);
  if (hostCommand !== fallbackHostCommand) {
    store.updateRun(run.id, { hostCommand });
  }

  const gateResult = await executePrompt({
    ...ctx,
    prompt: gatePrompt,
    cliArgs: job.cliArgs,
    onSpawn: (pid) => { store.updateRun(run.id, { hostPid: pid }); },
  });
  const answer = gateResult.output.trim().toLowerCase();
  const passed = /\byes\b/.test(answer);

  if (gateResult.status !== 'success' || !passed) {
    store.updateRun(run.id, {
      status: 'success',
      output: `Gate: ${answer}\n(condition not met — skipped action)`,
      durationMs: gateResult.durationMs,
      finishedAt: new Date().toISOString(),
    });
    store.updateJob(job.id, { lastOutcome: 'success', lastRunAt: Date.now() });
    return;
  }

  store.updateRun(run.id, { output: `Gate: yes\nExecuting action prompt...`, hostPid: null });
  const actionResult = await executeJobAction(job, ctx, {
    onSpawn: (pid) => { store.updateRun(run.id, { hostPid: pid }); },
  });

  store.updateRun(run.id, {
    status: actionResult.status,
    output: `Gate: yes\n---\n${actionResult.output}`,
    error: actionResult.error || undefined,
    durationMs: gateResult.durationMs + actionResult.durationMs,
    finishedAt: new Date().toISOString(),
  });
  store.updateJob(job.id, { lastOutcome: actionResult.status, lastRunAt: Date.now() });

  // Log activity for objective-linked gated jobs
  if (job.objectiveId && job.projectId) {
    try {
      const objectiveContext = await loadProjectObjectiveContext(job.projectId, job.objectiveId);
      if (objectiveContext) {
        const summary = actionResult.status === 'success'
          ? (actionResult.output || '').split('\n').filter(Boolean).slice(0, 3).join('\n') || 'Task completed successfully.'
          : `Task failed: ${actionResult.error || 'unknown error'}`;
        await appendObjectiveWorkerActivity({
          jobId: job.id,
          projectSlug: objectiveContext.project.slug,
          objectiveKey: objectiveContext.objective.key,
          body: `**${job.name}** — ${actionResult.status}\n\n${summary}`,
        });
      }
    } catch {
      // Activity logging is best-effort
    }
  }
}

async function fireRun(job: PromptJob, run: PromptRun) {
  const store = getPromptJobStore();
  const startedAt = new Date().toISOString();
  const fallbackHostCommand = buildHostCommand(
    (job.provider || 'claude') as ChatProvider,
    job.model || null,
  );
  store.updateRun(run.id, { status: 'running', startedAt, hostCommand: fallbackHostCommand });
  const ctx = await resolveJobContext(job);

  const hostCommand = buildHostCommand(ctx.provider, ctx.model);
  if (hostCommand !== fallbackHostCommand) {
    store.updateRun(run.id, { hostCommand });
  }

  const result = await executeJobAction(job, ctx, {
    onSpawn: (pid) => { store.updateRun(run.id, { hostPid: pid }); },
  });

  store.updateRun(run.id, {
    status: result.status,
    output: result.output,
    error: result.error || undefined,
    durationMs: result.durationMs,
    finishedAt: new Date().toISOString(),
  });
  store.updateJob(job.id, { lastOutcome: result.status, lastRunAt: Date.now() });

  // Log activity for objective-linked prompt jobs
  if (job.objectiveId && job.projectId) {
    try {
      const objectiveContext = await loadProjectObjectiveContext(job.projectId, job.objectiveId);
      if (objectiveContext) {
        const summary = result.status === 'success'
          ? (result.output || '').split('\n').filter(Boolean).slice(0, 3).join('\n') || 'Task completed successfully.'
          : `Task failed: ${result.error || 'unknown error'}`;
        await appendObjectiveWorkerActivity({
          jobId: job.id,
          projectSlug: objectiveContext.project.slug,
          objectiveKey: objectiveContext.objective.key,
          body: `**${job.name}** — ${result.status}\n\n${summary}`,
        });
      }
    } catch {
      // Activity logging is best-effort; don't fail the run
    }
  }
}

function dispatchRun(job: PromptJob, run: PromptRun) {
  const fn = job.condition ? fireConditionGate : fireRun;
  void fn(job, run).catch((err) => {
    const store = getPromptJobStore();
    store.updateRun(run.id, {
      status: 'failed',
      error: `Dispatch error: ${err instanceof Error ? err.message : String(err)}`,
      finishedAt: new Date().toISOString(),
    });
    store.updateJob(job.id, { lastOutcome: 'failed' });
  });
}

function schedulePumpRun() {
  if (!registeredPump || pumpScheduled) return;
  pumpScheduled = true;
  setTimeout(() => {
    pumpScheduled = false;
    void drainPromptJobPump();
  }, 0);
}

async function drainPromptJobPump() {
  if (!registeredPump || pumpRunning) return;

  pumpRunning = true;
  try {
    while (pumpPending) {
      pumpPending = false;
      await registeredPump();
    }
  } finally {
    pumpRunning = false;
    if (pumpPending) {
      schedulePumpRun();
    }
  }
}

export function registerPromptJobPump(processor: () => Promise<void>): void {
  registeredPump = processor;
  if (pumpPending) {
    schedulePumpRun();
  }
}

export function requestPromptJobPump(): boolean {
  pumpPending = true;
  if (!registeredPump) {
    return false;
  }
  schedulePumpRun();
  return true;
}

export async function processPromptJobs(): Promise<{
  queued: PromptRun[];
  skipped: Array<{ jobId: string; reason: string }>;
  dispatched: number;
}> {
  const store = getPromptJobStore();
  const result = await pollDueJobs(store);
  const queuedRuns = store.listQueuedRuns(200);

  let dispatched = 0;
  for (const run of queuedRuns) {
    const job = store.getJob(run.jobId);
    if (!job) continue;
    dispatchRun(job, run);
    dispatched++;
  }

  return {
    queued: result.queued,
    skipped: result.skipped,
    dispatched,
  };
}
