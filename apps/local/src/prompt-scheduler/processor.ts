import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import { getPromptJobStore } from './get-store';
import { pollDueJobs } from './engine';
import { getAgent, getAgentSkills, getProjectAgents, getTeamAgents } from '@/lib/db';
import { LOCAL_USER } from '@/lib/auth-mode';
import { loadDbParticipants } from '@/lib/agent-participants';
import { runCliResponse, buildCliAttempts } from '@/lib/cli-runner';
import { startScriptedLinearSession } from '@/lib/linear-scripted-session';
import {
  isObjectiveLinearTerminalStatus,
} from '@/lib/objective-linear-issues';
import {
  loadProjectObjectiveContext,
} from '@/lib/project-objective-context';
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

  if (teamId) {
    const teamAgents = await getTeamAgents(teamId);
    for (const teamAgent of teamAgents) {
      const participant = participants.find((entry) => entry.id === teamAgent.agent_id) ?? null;
      if (participant) {
        return participant;
      }
    }
    throw new Error('No agent in the assigned team is available to work this objective.');
  }

  if (!job.projectId) {
    throw new Error('Objective worker requires a project context to resolve an agent.');
  }

  const projectAgents = await getProjectAgents(job.projectId);
  for (const projectAgent of projectAgents) {
    const participant = participants.find((entry) => entry.id === projectAgent.agent_id) ?? null;
    if (participant) {
      return participant;
    }
  }

  throw new Error('No project agent is available to run the objective worker.');
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

export async function dispatchObjectiveAction(opts: {
  action: string;
  parsed: Record<string, unknown> | null;
  reason: string;
  job: PromptJob;
  controllerContext: {
    provider: ChatProvider;
    model: string | null;
    identity: string | undefined;
    self: string | undefined;
    skills: string | undefined;
  };
  sessionAgent: Participant;
  objectiveContext: NonNullable<Awaited<ReturnType<typeof loadProjectObjectiveContext>>>;
  eligibleIssues: LinearIssueSummary[];
  issues: LinearIssueSummary[];
  healthSummaries: {
    objectiveHealthSummary: string | null;
    projectHealthSummary: string | null;
    objectiveNote: string;
    projectNote: string;
  };
  cliArgs?: string;
  onSpawn?: (pid: number) => void;
  startMs: number;
}): Promise<import('./types').ActionReceipt> {
  const { action, parsed, reason, healthSummaries } = opts;

  if (action === 'stop') {
    const hasNonTerminalIssues = opts.issues.some((issue) => !isObjectiveLinearTerminalStatus(issue.status));
    const fallbackReason =
      opts.issues.length === 0
        ? 'No objective-labeled Linear tickets were found.'
        : opts.eligibleIssues.length === 0
          ? hasNonTerminalIssues
            ? 'All actionable objective tickets already have active sessions.'
            : 'All objective tickets are already in a terminal state.'
          : 'The controller decided that no ticket should be started right now.';
    const stopReason = reason || fallbackReason;

    return {
      action: 'stop',
      jobName: opts.job.name,
      reason: stopReason,
      result: [
        'No action taken.',
        `Reason: ${stopReason}`,
        healthSummaries.objectiveHealthSummary,
        healthSummaries.objectiveNote || null,
        healthSummaries.projectHealthSummary,
        healthSummaries.projectNote || null,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n\n'),
      durationMs: Date.now() - opts.startMs,
      status: 'success',
    };
  }

  if (action === 'run_prompt') {
    const promptText = typeof parsed?.prompt === 'string' ? parsed.prompt.trim() : '';
    if (!promptText) {
      return {
        action: 'run_prompt',
        jobName: opts.job.name,
        reason,
        result: 'Controller returned run_prompt but provided no prompt text.',
        durationMs: Date.now() - opts.startMs,
        status: 'failed',
      };
    }

    const promptResult = await executePrompt({
      ...opts.controllerContext,
      prompt: promptText,
      cliArgs: opts.cliArgs,
      onSpawn: opts.onSpawn,
    });

    const summary = promptResult.status === 'success'
      ? (promptResult.output || '').split('\n').filter(Boolean).slice(0, 10).join('\n') || 'Prompt completed.'
      : `Prompt failed: ${promptResult.error || 'unknown error'}`;

    return {
      action: 'run_prompt',
      jobName: opts.job.name,
      reason,
      result: [
        summary,
        healthSummaries.objectiveHealthSummary,
        healthSummaries.projectHealthSummary,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n\n'),
      durationMs: Date.now() - opts.startMs,
      status: promptResult.status,
    };
  }

  if (action === 'work_ticket') {
    const ticketId = typeof parsed?.ticketId === 'string' ? parsed.ticketId.trim() : '';
    const selectedIssue = opts.eligibleIssues.find((issue) => issue.id === ticketId) ?? null;
    if (!selectedIssue) {
      return {
        action: 'work_ticket',
        jobName: opts.job.name,
        reason,
        result: `Controller selected an unknown ticket: ${ticketId || '(empty)'}`,
        durationMs: Date.now() - opts.startMs,
        status: 'failed',
      };
    }

    const launch = await startScriptedLinearSession({
      projectId: opts.objectiveContext.project.id,
      projectSlug: opts.objectiveContext.project.slug,
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

    return {
      action: 'work_ticket',
      jobName: opts.job.name,
      reason,
      result: [
        `Started work on ${issueLink}: ${selectedIssue.title}`,
        reason ? `Reason: ${reason}` : null,
        healthSummaries.objectiveHealthSummary,
        healthSummaries.objectiveNote || null,
        healthSummaries.projectHealthSummary,
        healthSummaries.projectNote || null,
        `Linear run: ${launch.run.id}`,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n\n'),
      linearRunId: launch.run.id,
      chatRunId: launch.chatRunId,
      durationMs: Date.now() - opts.startMs,
      status: 'success',
    };
  }

  // Unknown action
  return {
    action: action || 'unknown',
    jobName: opts.job.name,
    reason,
    result: `Controller returned an invalid action: ${action || '(empty)'}`,
    durationMs: Date.now() - opts.startMs,
    status: 'failed',
  };
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
  if (job.executionMode === 'objective_worker') {
    const { executeObjectiveWorker } = await import('./objective-worker');
    const sessionAgent = await resolveObjectiveWorkerAgent(job);
    const controllerContext = await resolveJobContextForAgent(job, sessionAgent.id);
    return executeObjectiveWorker({
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
    if (job.objectiveId && job.projectId) {
      await logActionReceipt(
        {
          action: 'gated_skip',
          jobName: job.name,
          reason: 'condition not met',
          result: `Gate: ${answer}\n(condition not met — skipped action)`,
          durationMs: gateResult.durationMs,
          status: 'success',
        },
        { jobId: job.id, projectId: job.projectId, objectiveId: job.objectiveId },
      );
    }
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

  if (job.objectiveId && job.projectId) {
    await logActionReceipt(
      {
        action: 'prompt',
        jobName: job.name,
        reason: 'condition gate passed',
        result: actionResult.status === 'success'
          ? (actionResult.output || '').split('\n').filter(Boolean).slice(0, 3).join('\n') || 'Task completed successfully.'
          : `Task failed: ${actionResult.error || 'unknown error'}`,
        durationMs: gateResult.durationMs + actionResult.durationMs,
        status: actionResult.status,
      },
      { jobId: job.id, projectId: job.projectId, objectiveId: job.objectiveId },
    );
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

  if (job.objectiveId && job.projectId) {
    await logActionReceipt(
      {
        action: 'prompt',
        jobName: job.name,
        reason: '',
        result: result.status === 'success'
          ? (result.output || '').split('\n').filter(Boolean).slice(0, 3).join('\n') || 'Task completed successfully.'
          : `Task failed: ${result.error || 'unknown error'}`,
        durationMs: result.durationMs,
        status: result.status,
      },
      { jobId: job.id, projectId: job.projectId, objectiveId: job.objectiveId },
    );
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
