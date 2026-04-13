import { NextRequest, NextResponse } from 'next/server';
import { getPromptJobStore } from '@/src/prompt-scheduler/get-store';
import {
  computeNextRun,
  normalizeLegacyConditionSchedule,
  parseCadence,
} from '@/src/prompt-scheduler/cron';
import {
  DEFAULT_OBJECTIVE_LINEAR_WORKER_PROMPT,
  type PromptJobState,
} from '@/src/prompt-scheduler/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveScheduledPayload(input: {
  cadence?: unknown;
  triggerType?: unknown;
  checkEveryMs?: unknown;
}): { cadence: string; cronExpr: string } | null {
  if (typeof input.cadence === 'string' && input.cadence.trim()) {
    const parsed = parseCadence(input.cadence.trim());
    return parsed ? { cadence: parsed.cadence, cronExpr: parsed.cronExpr } : null;
  }

  if (input.triggerType === 'condition') {
    const legacy = normalizeLegacyConditionSchedule(
      typeof input.checkEveryMs === 'number' ? input.checkEveryMs : 300000,
    );
    return { cadence: legacy.cadence, cronExpr: legacy.cronExpr };
  }

  return null;
}

/**
 * GET /api/prompt-jobs
 * List all jobs, optionally filtered by ?state=active|paused|stopped
 */
export async function GET(req: NextRequest) {
  try {
    const store = getPromptJobStore();
    const state = req.nextUrl.searchParams.get('state') as PromptJobState | null;
    const projectId = req.nextUrl.searchParams.get('projectId') ?? undefined;
    const objectiveId = req.nextUrl.searchParams.get('objectiveId') ?? undefined;
    const includeObjectiveJobs = req.nextUrl.searchParams.get('includeObjectiveJobs') === 'true';
    const filter: {
      state?: PromptJobState;
      projectId?: string;
      objectiveId?: string;
      includeObjectiveJobs?: boolean;
    } = {
      includeObjectiveJobs,
    };
    if (state) filter.state = state;
    if (projectId) filter.projectId = projectId;
    if (objectiveId) filter.objectiveId = objectiveId;
    const jobs = store.listJobs(Object.keys(filter).length > 0 ? filter : undefined);

    // Auto-heal active jobs with null nextRunAt
    for (const job of jobs) {
      if (job.state === 'active' && job.nextRunAt === null) {
        let cronExpr = job.cronExpr || job.cadence;
        // If cronExpr isn't valid cron, try parsing it as NL
        let nextRunAt = computeNextRun(cronExpr);
        if (nextRunAt === null) {
          const parsed = parseCadence(cronExpr);
          if (parsed) {
            cronExpr = parsed.cronExpr;
            nextRunAt = computeNextRun(cronExpr);
            if (nextRunAt) store.updateJob(job.id, { cronExpr });
          }
        }
        if (nextRunAt) {
          store.updateJob(job.id, { nextRunAt });
          job.nextRunAt = nextRunAt;
        }
      }
    }

    return NextResponse.json({ count: jobs.length, jobs });
  } catch (error) {
    console.error('Failed to list prompt jobs:', error);
    return NextResponse.json(
      { error: 'Failed to list prompt jobs', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/prompt-jobs
 * Create a new prompt job.
 * Body: { name, prompt, cli?, cadence, overlapPolicy?, cancelCheckSec? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      name,
      prompt,
      agentId,
      projectId,
      provider,
      model,
      cliArgs,
      objectiveId,
      objectiveKey,
      executionMode,
      cadence,
      overlapPolicy,
      catchUpPolicy,
      cancelCheckSec,
      triggerType,
      condition,
      checkEveryMs,
    } = body;

    const resolvedPrompt =
      typeof prompt === 'string' && prompt.trim()
        ? prompt
        : executionMode === 'objective_linear_ticket'
          ? DEFAULT_OBJECTIVE_LINEAR_WORKER_PROMPT
          : '';

    if (!name || !resolvedPrompt) {
      return NextResponse.json(
        { error: 'Missing required fields: name, prompt' },
        { status: 400 },
      );
    }

    const scheduled = resolveScheduledPayload({ cadence, triggerType, checkEveryMs });
    if (!scheduled) {
      return NextResponse.json(
        { error: 'Missing required field: cadence (or legacy condition interval to convert)' },
        { status: 400 },
      );
    }

    const store = getPromptJobStore();
    const job = store.createJob({
      name,
      prompt: resolvedPrompt,
      agentId,
      projectId,
      objectiveId,
      objectiveKey,
      executionMode,
      provider: provider ?? 'claude',
      model,
      cliArgs,
      cronExpr: scheduled.cronExpr,
      cadence: scheduled.cadence,
      overlapPolicy,
      catchUpPolicy,
      cancelCheckSec,
      condition,
    });

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    console.error('Failed to create prompt job:', error);
    return NextResponse.json(
      { error: 'Failed to create prompt job', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
