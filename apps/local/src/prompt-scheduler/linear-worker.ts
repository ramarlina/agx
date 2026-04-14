import { getPromptJobStore } from './get-store';
import {
  ensureLinearIssueCache,
  listLinearIssueSummaries,
} from '@/lib/linear-issues';
import { getIssueActiveAgents, type IssueActiveAgent } from '@/lib/linear-run-store';
import { isObjectiveLinearTerminalStatus } from '@/lib/objective-linear-issues';
import { runCliResponse } from '@/lib/cli-runner';
import { startScriptedLinearSession } from '@/lib/linear-scripted-session';
import type { ChatProvider } from '@/lib/types';
import type { LinearIssueSummary } from '@/lib/linear-issues';
import type { Participant } from '@/lib/types';
import type { PromptJob, ActionReceipt } from './types';

// ---------------------------------------------------------------------------
// System context for the controller LLM
// ---------------------------------------------------------------------------

const LINEAR_WORKER_SYSTEM_CONTEXT = [
  'You are deciding what action a Linear workspace worker should take next.',
  'You are observing the FULL Linear workspace — all teams, all issues.',
  'Use the GUIDING PROMPT to prioritize and decide what matters most.',
  'Return ONLY raw JSON with no markdown fences or commentary.',
  'Valid responses:',
  '{"action":"work_ticket","ticketId":"ticket-id","reason":"..."}',
  '{"action":"run_prompt","prompt":"detailed instructions","reason":"..."}',
  '{"action":"stop","reason":"..."}',
  'Rules:',
  '- "work_ticket": ticketId must exactly match one of the ELIGIBLE TICKETS ids.',
  '- "run_prompt": for work not captured by existing tickets.',
  '- "stop": when no action should be taken now.',
].join('\n');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function extractFirstJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const directParse = tryParseJsonObject(trimmed);
  if (directParse) return directParse;

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  return tryParseJsonObject(trimmed.slice(start, end + 1));
}

function formatIssueLine(issue: LinearIssueSummary): string {
  return [
    `- id: ${issue.id}`,
    `  identifier: ${issue.identifier}`,
    `  title: ${issue.title}`,
    `  status: ${issue.status}`,
    `  assignee: ${issue.assignee ?? 'Unassigned'}`,
    issue.url ? `  url: ${issue.url}` : null,
    issue.labels && issue.labels.length > 0 ? `  labels: ${issue.labels.join(', ')}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

// ---------------------------------------------------------------------------
// buildLinearWorkerObservation
// ---------------------------------------------------------------------------

export interface LinearWorkerObservation {
  prompt: string;
  issues: LinearIssueSummary[];
  eligibleIssues: LinearIssueSummary[];
  activeIssueAgents: IssueActiveAgent[];
}

export async function buildLinearWorkerObservation(opts: {
  job: PromptJob;
  projectId?: string;
  projectSlug?: string;
}): Promise<LinearWorkerObservation> {
  const { job, projectSlug } = opts;

  // Refresh the cache and fetch all issues
  await ensureLinearIssueCache({
    refresh: true,
    projectSlug: projectSlug ?? undefined,
  });

  const [
    { issues },
    activeIssueAgents,
  ] = await Promise.all([
    listLinearIssueSummaries({ limit: 500 }),
    opts.projectId
      ? getIssueActiveAgents(opts.projectId)
      : Promise.resolve([] as IssueActiveAgent[]),
  ]);

  // Filter out terminal issues and issues with active sessions
  const activeIssueIds = new Set(activeIssueAgents.map((a) => a.issueId));
  const eligibleIssues = issues.filter(
    (issue) =>
      !isObjectiveLinearTerminalStatus(issue.status) &&
      !activeIssueIds.has(issue.id),
  );

  // Gather scheduled tasks (linear worker jobs, excluding current)
  const store = getPromptJobStore();
  const allJobs = store.listJobs(
    opts.projectId ? { projectId: opts.projectId } : undefined,
  );
  const scheduledTasks = allJobs.filter(
    (j) => j.id !== job.id && j.executionMode === 'linear_worker',
  );

  // Assemble the prompt sections
  const sections: string[] = [];

  // WORKSPACE STATE
  sections.push('WORKSPACE STATE');

  // Issue status summary
  const statusCounts = new Map<string, number>();
  for (const issue of issues) {
    statusCounts.set(issue.status, (statusCounts.get(issue.status) || 0) + 1);
  }
  sections.push(
    '',
    'ISSUE STATUS SUMMARY',
    ...Array.from(statusCounts.entries()).map(
      ([status, count]) => `- ${status}: ${count} issues`,
    ),
  );

  // ALL TICKETS
  if (issues.length > 0) {
    sections.push(
      '',
      'ALL LINEAR TICKETS',
      issues.map((issue) => formatIssueLine(issue)).join('\n\n'),
    );
  } else {
    sections.push('', 'ALL LINEAR TICKETS', '- None.');
  }

  // ACTIVE SESSIONS
  if (activeIssueAgents.length > 0) {
    sections.push(
      '',
      'ACTIVE SESSIONS',
      ...activeIssueAgents.map(
        (entry) => `- ${entry.issueId}: running with ${entry.agentName}`,
      ),
    );
  }

  // OTHER LINEAR WORKERS
  if (scheduledTasks.length > 0) {
    sections.push(
      '',
      'OTHER LINEAR WORKERS',
      ...scheduledTasks.map(
        (t) =>
          `- ${t.name} | state: ${t.state} | last outcome: ${t.lastOutcome ?? 'none'}`,
      ),
    );
  }

  // GUIDING PROMPT
  sections.push(
    '',
    'GUIDING PROMPT',
    job.prompt.trim() || 'No guiding prompt provided. Pick the highest-priority actionable ticket.',
  );

  // ELIGIBLE TICKETS
  sections.push(
    '',
    'ELIGIBLE TICKETS',
    eligibleIssues.length > 0
      ? eligibleIssues.map((issue) => formatIssueLine(issue)).join('\n\n')
      : '- None.',
  );

  // Final question
  sections.push(
    '',
    '---',
    'Based on the full workspace state and the guiding prompt, what single action should be taken right now?',
  );

  return {
    prompt: sections.join('\n'),
    issues,
    eligibleIssues,
    activeIssueAgents,
  };
}

// ---------------------------------------------------------------------------
// executeLinearWorker — the observe -> decide -> act pipeline
// ---------------------------------------------------------------------------

export async function executeLinearWorker(opts: {
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
    // Phase 1: Observe - gather full workspace state
    const observation = await buildLinearWorkerObservation({
      job: opts.job,
      projectId: opts.job.projectId || undefined,
      projectSlug: undefined,
    });

    // Phase 2: Decide - run controller LLM
    const controllerResult = await executePrompt({
      ...opts.controllerContext,
      prompt: observation.prompt,
      systemContext: LINEAR_WORKER_SYSTEM_CONTEXT,
      cliArgs: opts.cliArgs,
      onSpawn: opts.onSpawn,
    });

    if (controllerResult.status !== 'success') {
      return {
        ...controllerResult,
        output: controllerResult.output || 'Linear worker controller failed before selecting an action.',
      };
    }

    // Phase 3: Parse - extract JSON action from controller output
    const parsed = extractFirstJsonObject(controllerResult.output);
    const rawAction = typeof parsed?.action === 'string'
      ? parsed.action.trim().toLowerCase()
      : typeof parsed?.decision === 'string'
        ? (parsed.decision as string).trim().toLowerCase()
        : '';
    const action = rawAction === 'work' ? 'work_ticket' : rawAction;
    const reason = typeof parsed?.reason === 'string' ? parsed.reason.trim() : '';

    // Phase 4: Act - dispatch action
    const receipt = await dispatchLinearWorkerAction({
      action,
      parsed,
      reason,
      job: opts.job,
      controllerContext: opts.controllerContext,
      sessionAgent: opts.sessionAgent,
      eligibleIssues: observation.eligibleIssues,
      issues: observation.issues,
      cliArgs: opts.cliArgs,
      onSpawn: opts.onSpawn,
      startMs,
    });

    return {
      output: receipt.result,
      error: receipt.status === 'failed' ? receipt.result : '',
      durationMs: Date.now() - startMs,
      status: receipt.status,
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

// ---------------------------------------------------------------------------
// dispatchLinearWorkerAction
// ---------------------------------------------------------------------------

async function dispatchLinearWorkerAction(opts: {
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
  eligibleIssues: LinearIssueSummary[];
  issues: LinearIssueSummary[];
  cliArgs?: string;
  onSpawn?: (pid: number) => void;
  startMs: number;
}): Promise<ActionReceipt> {
  const { action, parsed, reason } = opts;

  if (action === 'stop') {
    const hasNonTerminalIssues = opts.issues.some(
      (issue) => !isObjectiveLinearTerminalStatus(issue.status),
    );
    const fallbackReason =
      opts.issues.length === 0
        ? 'No Linear tickets were found in the workspace.'
        : opts.eligibleIssues.length === 0
          ? hasNonTerminalIssues
            ? 'All actionable tickets already have active sessions.'
            : 'All tickets are already in a terminal state.'
          : 'The controller decided that no ticket should be started right now.';
    const stopReason = reason || fallbackReason;

    return {
      action: 'stop',
      jobName: opts.job.name,
      reason: stopReason,
      result: `No action taken.\n\nReason: ${stopReason}`,
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
      result: summary,
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

    if (!opts.job.projectId) {
      return {
        action: 'work_ticket',
        jobName: opts.job.name,
        reason,
        result: 'Linear worker requires a project context to start a scripted session.',
        durationMs: Date.now() - opts.startMs,
        status: 'failed',
      };
    }

    const launch = await startScriptedLinearSession({
      projectId: opts.job.projectId,
      projectSlug: opts.job.projectId,
      issue: {
        id: selectedIssue.id,
        identifier: selectedIssue.identifier,
        title: selectedIssue.title,
        status: selectedIssue.status,
        assignee: selectedIssue.assignee,
      },
      agentId: opts.sessionAgent.id,
      scriptPrompt: opts.job.scriptPrompt || undefined,
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
