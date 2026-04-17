import { getPromptJobStore } from './get-store';
import {
  listObjectiveTrackerIssues as listObjectiveLinearIssues,
  filterObjectiveTrackerIssuesForAction as filterObjectiveLinearIssuesForAction,
  isObjectiveTrackerTerminalStatus as isObjectiveLinearTerminalStatus,
} from '@/lib/objective-tracker-issues';
import { getIssueActiveAgents, type IssueActiveAgent } from '@/lib/linear-run-store';
import { getActivityRepository } from '@/src/objectives/activities/repository';
import { getNoteRepository } from '@/src/objectives/notes';
import {
  loadProjectObjectiveContext,
  persistProjectObjectiveMetadata,
  persistProjectObjectiveWorkspace,
  type ProjectObjectiveContext,
} from '@/lib/project-objective-context';
import { appendObjectiveHealthSample } from '@/lib/objective-health-history';
import { runCliResponse, buildCliAttempts } from '@/lib/cli-runner';
import {
  normalizeProjectHealthProgress,
  normalizeProjectHealthStatus,
  upsertProjectObjective,
  writeProjectHealthSnapshot,
  type ProjectHealthSnapshot,
  type ProjectObjectiveHealth,
} from '@/lib/project-objectives';
import type { ChatProvider } from '@/lib/types';
import type { LinearIssueSummary } from '@/lib/linear-issues';
import type { Participant } from '@/lib/types';
import type { PromptJob, ActionReceipt } from './types';

// ---------------------------------------------------------------------------
// System context for the controller LLM
// ---------------------------------------------------------------------------

const OBJECTIVE_CONTROLLER_SYSTEM_CONTEXT = [
  'You are deciding what action an objective worker should take next.',
  'Return ONLY raw JSON with no markdown fences or commentary.',
  'Valid responses:',
  '{"action":"work_ticket","ticketId":"ticket-id","reason":"...","objectiveProgress":42,"objectiveStatus":"at_risk","projectProgress":35,"projectStatus":"at_risk"}',
  '{"action":"run_prompt","prompt":"detailed instructions","reason":"...","objectiveProgress":42,"objectiveStatus":"at_risk"}',
  '{"action":"stop","reason":"...","objectiveProgress":42,"objectiveStatus":"at_risk"}',
  'Rules:',
  '- "work_ticket": ticketId must exactly match one of the ELIGIBLE TICKETS ids.',
  '- "run_prompt": for work not captured by existing tickets. When no tickets are actionable and the objective is not done, use this to plan: review notes, refine the last plan, or outline next steps. The prompt should instruct the agent to append to an existing note when one is relevant rather than creating a new note.',
  '- "stop": only when the objective is done or genuinely no action (including planning) adds value.',
  'Percentages must be integers 0-100.',
  'Statuses: on_track, at_risk, off_track, done.',
].join('\n');

// ---------------------------------------------------------------------------
// Helpers (copied from processor.ts to avoid circular deps)
// ---------------------------------------------------------------------------

const HEALTH_LABELS: Record<ProjectObjectiveHealth, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
  done: 'Done',
};

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

export function extractFirstJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const directParse = tryParseJsonObject(trimmed);
  if (directParse) return directParse;

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  return tryParseJsonObject(trimmed.slice(start, end + 1));
}

function normalizeAssessmentProgress(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return normalizeProjectHealthProgress(value);
}

function normalizeAssessmentStatus(value: unknown): ProjectObjectiveHealth | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return normalizeProjectHealthStatus(value);
}

function formatHealthSummary(scope: string, progress: number, status: ProjectObjectiveHealth): string {
  return `${scope}: ${progress}% ${HEALTH_LABELS[status]}`;
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

// ---------------------------------------------------------------------------
// buildObjectiveObservation
// ---------------------------------------------------------------------------

export interface ObjectiveObservation {
  prompt: string;
  issues: LinearIssueSummary[];
  eligibleIssues: LinearIssueSummary[];
  activeIssueAgents: IssueActiveAgent[];
}

export async function buildObjectiveObservation(opts: {
  job: PromptJob;
  objectiveContext: ProjectObjectiveContext;
}): Promise<ObjectiveObservation> {
  const { job, objectiveContext } = opts;
  const { project, workspace, objective } = objectiveContext;
  const projectSlug = project.slug ?? project.id;

  // Gather all data sources in parallel
  const [
    { issues },
    activeIssueAgents,
    activityPage,
    notes,
  ] = await Promise.all([
    listObjectiveLinearIssues({
      projectId: project.id,
      objectiveKey: objective.key,
      projectSlug,
      refresh: true,
    }),
    getIssueActiveAgents(project.id),
    Promise.resolve(
      getActivityRepository(projectSlug, objective.key).list({ limit: 20 }),
    ),
    Promise.resolve(
      getNoteRepository(projectSlug, objective.key).readAll(),
    ),
  ]);

  const objectiveIssueIds = new Set(issues.map((issue) => issue.id));
  const activeObjectiveAgents = activeIssueAgents.filter(
    (entry) => objectiveIssueIds.has(entry.issueId),
  );
  const eligibleIssues = filterObjectiveLinearIssuesForAction(
    issues,
    activeObjectiveAgents.map((entry) => entry.issueId),
  );

  // Gather scheduled tasks for this objective
  const store = getPromptJobStore();
  const allJobs = store.listJobs({ objectiveId: objective.id });
  const scheduledTasks = allJobs.filter((j) => j.id !== job.id);

  // Build sibling objectives (exclude current)
  const siblingObjectives = workspace.objectives.filter(
    (o) => o.id !== objective.id,
  );

  // Assemble the prompt sections
  const sections: string[] = [];

  // GOAL
  sections.push(
    'GOAL',
    objective.title,
    objective.summary?.trim() || 'No summary provided.',
  );

  // CURRENT STATE
  sections.push(
    '',
    'CURRENT STATE',
    `Progress: ${objective.progress}% | Status: ${objective.status}`,
  );

  // NOTES
  if (notes.length > 0) {
    sections.push(
      '',
      'NOTES',
      ...notes.map((note) => `### ${note.title}\n${note.body}`),
    );
  }

  // RECENT ACTIVITY
  const activities = activityPage.activities ?? [];
  if (activities.length > 0) {
    sections.push(
      '',
      'RECENT ACTIVITY',
      ...activities.map((activity) => {
        const ts = activity.createdAt.replace('T', ' ').replace(/\.\d+Z$/, '').slice(0, 16);
        return `- [${ts}] ${activity.body.split('\n')[0]}`;
      }),
    );
  }

  // LINEAR TICKETS
  if (issues.length > 0) {
    sections.push(
      '',
      'LINEAR TICKETS',
      issues.map((issue) => formatIssueLine(issue)).join('\n\n'),
    );
  } else {
    sections.push('', 'LINEAR TICKETS', '- None.');
  }

  // ACTIVE SESSIONS
  if (activeObjectiveAgents.length > 0) {
    sections.push(
      '',
      'ACTIVE SESSIONS',
      ...activeObjectiveAgents.map(
        (entry) => `- ${entry.issueId}: running with ${entry.agentName}`,
      ),
    );
  }

  // SCHEDULED TASKS
  if (scheduledTasks.length > 0) {
    sections.push(
      '',
      'SCHEDULED TASKS',
      ...scheduledTasks.map(
        (t) => `- ${t.name} | state: ${t.state} | last outcome: ${t.lastOutcome ?? 'none'}`,
      ),
    );
  }

  // PROJECT CONTEXT
  if (siblingObjectives.length > 0) {
    sections.push(
      '',
      'PROJECT CONTEXT',
      ...siblingObjectives.map(
        (o) => `- ${o.title} (${o.key}) | ${o.progress}% | ${o.status}`,
      ),
    );
  }

  // GUIDANCE
  sections.push(
    '',
    'GUIDANCE',
    job.prompt.trim() || 'No additional guidance provided.',
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
    'What single action most advances this objective right now?',
  );

  return {
    prompt: sections.join('\n'),
    issues,
    eligibleIssues,
    activeIssueAgents: activeObjectiveAgents,
  };
}

// ---------------------------------------------------------------------------
// executeObjectiveWorker — the observe → decide → act → receipt pipeline
// ---------------------------------------------------------------------------

export async function executeObjectiveWorker(opts: {
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
      throw new Error('Objective worker jobs require projectId and objectiveId.');
    }

    const objectiveContext = await loadProjectObjectiveContext(
      opts.job.projectId,
      opts.job.objectiveId,
    );
    if (!objectiveContext) {
      throw new Error('Objective context could not be resolved for this scheduled task.');
    }

    // Phase 1: Observe — gather all objective state
    const observation = await buildObjectiveObservation({
      job: opts.job,
      objectiveContext,
    });

    // Phase 2: Decide — run controller LLM
    const controllerResult = await executePrompt({
      ...opts.controllerContext,
      prompt: observation.prompt,
      systemContext: OBJECTIVE_CONTROLLER_SYSTEM_CONTEXT,
      cliArgs: opts.cliArgs,
      onSpawn: opts.onSpawn,
    });

    if (controllerResult.status !== 'success') {
      return {
        ...controllerResult,
        output: controllerResult.output || 'Objective controller failed before selecting an action.',
      };
    }

    // Phase 3: Parse — extract JSON action from controller output
    const parsed = extractFirstJsonObject(controllerResult.output);
    const rawAction = typeof parsed?.action === 'string'
      ? parsed.action.trim().toLowerCase()
      : typeof parsed?.decision === 'string'
        ? (parsed.decision as string).trim().toLowerCase()
        : '';
    const action = rawAction === 'work' ? 'work_ticket' : rawAction;
    const reason = typeof parsed?.reason === 'string' ? parsed.reason.trim() : '';
    const objectiveProgress = normalizeAssessmentProgress(parsed?.objectiveProgress);
    const objectiveStatus = normalizeAssessmentStatus(parsed?.objectiveStatus);
    const projectProgress = normalizeAssessmentProgress(parsed?.projectProgress);
    const projectStatus = normalizeAssessmentStatus(parsed?.projectStatus);
    const projectNote = typeof parsed?.projectNote === 'string' ? parsed.projectNote.trim() : '';
    const objectiveNote = typeof parsed?.objectiveNote === 'string' ? parsed.objectiveNote.trim() : '';
    const nowIso = new Date().toISOString();

    // Phase 4: Health — apply objective/project health side-effects
    const objectiveHealthSummary =
      objectiveProgress !== null && objectiveStatus
        ? formatHealthSummary('Objective health', objectiveProgress, objectiveStatus)
        : null;
    const projectHealthSummary =
      projectProgress !== null && projectStatus
        ? formatHealthSummary('Project health', projectProgress, projectStatus)
        : null;

    const objectiveSample =
      objectiveProgress !== null && objectiveStatus !== null
        ? {
            objectiveId: objectiveContext.objective.id,
            objectiveKey: objectiveContext.objective.key,
            progress: objectiveProgress,
            status: objectiveStatus,
            recordedAt: nowIso,
            source: `scheduled-task:${opts.job.id}`,
            note: objectiveNote || undefined,
          }
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

    const applyObjectiveHealthMetadata = (metadata: Record<string, unknown>) => {
      let nextMetadata = metadata;
      if (projectSnapshot) {
        nextMetadata = writeProjectHealthSnapshot(nextMetadata, projectSnapshot);
      }
      if (objectiveSample) {
        nextMetadata = appendObjectiveHealthSample(nextMetadata, objectiveSample);
      }
      return nextMetadata;
    };

    if (objectiveChanged) {
      await persistProjectObjectiveWorkspace({
        projectId: objectiveContext.project.id,
        currentMetadata: objectiveContext.project.metadata,
        workspace: nextWorkspace,
        transformMetadata: applyObjectiveHealthMetadata,
      });
    } else if (objectiveSample || projectSnapshot) {
      await persistProjectObjectiveMetadata({
        projectId: objectiveContext.project.id,
        currentMetadata: objectiveContext.project.metadata,
        transformMetadata: applyObjectiveHealthMetadata,
      });
    }

    // Phase 5: Act — dispatch action (dynamic import to avoid circular deps)
    const { dispatchObjectiveAction } = await import('./processor');
    const receipt = await dispatchObjectiveAction({
      action,
      parsed,
      reason,
      job: opts.job,
      controllerContext: opts.controllerContext,
      sessionAgent: opts.sessionAgent,
      objectiveContext,
      eligibleIssues: observation.eligibleIssues,
      issues: observation.issues,
      healthSummaries: {
        objectiveHealthSummary,
        projectHealthSummary,
        objectiveNote,
        projectNote,
      },
      cliArgs: opts.cliArgs,
      onSpawn: opts.onSpawn,
      startMs,
    });

    // Phase 6: Receipt — log to activity timeline
    const { logActionReceipt } = await import('./processor');
    await logActionReceipt(receipt, {
      jobId: opts.job.id,
      projectId: opts.job.projectId,
      objectiveId: opts.job.objectiveId!,
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
