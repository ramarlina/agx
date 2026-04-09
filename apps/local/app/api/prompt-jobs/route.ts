import { NextRequest, NextResponse } from 'next/server';
import { getPromptJobStore } from '@/src/prompt-scheduler/get-store';
import { parseCadence, computeNextRun } from '@/src/prompt-scheduler/cron';
import type { PromptJobState } from '@/src/prompt-scheduler/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/prompt-jobs
 * List all jobs, optionally filtered by ?state=active|paused|stopped
 */
export async function GET(req: NextRequest) {
  try {
    const store = getPromptJobStore();
    const state = req.nextUrl.searchParams.get('state') as PromptJobState | null;
    const projectId = req.nextUrl.searchParams.get('projectId') ?? undefined;
    const filter: { state?: PromptJobState; projectId?: string } = {};
    if (state) filter.state = state;
    if (projectId) filter.projectId = projectId;
    const jobs = store.listJobs(Object.keys(filter).length > 0 ? filter : undefined);

    // Auto-heal active jobs with null nextRunAt
    for (const job of jobs) {
      if (job.state === 'active' && job.nextRunAt === null) {
        let cronExpr = job.cronExpr;
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
        if (nextRunAt === null && job.triggerType === 'condition') {
          nextRunAt = Date.now() + job.checkEveryMs;
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
    const { name, prompt, agentId, projectId, provider, model, cliArgs, cadence, overlapPolicy, catchUpPolicy, cancelCheckSec, triggerType, condition, checkEveryMs } = body;

    if (!name || !prompt) {
      return NextResponse.json(
        { error: 'Missing required fields: name, prompt' },
        { status: 400 },
      );
    }

    // For condition triggers, cadence is optional (uses checkEveryMs instead)
    const effectiveTriggerType = triggerType ?? 'scheduled';
    if (effectiveTriggerType === 'scheduled' && !cadence) {
      return NextResponse.json(
        { error: 'Missing required field: cadence (required for scheduled triggers)' },
        { status: 400 },
      );
    }

    // cadence can be either a cron expression (from schedule builder) or natural language
    let cronExpr = '';
    let cadenceLabel = '';
    if (cadence) {
      const parsed = parseCadence(cadence);
      if (parsed) {
        cronExpr = parsed.cronExpr;
        cadenceLabel = parsed.cadence;
      } else {
        // Might already be a raw cron expression from the schedule builder
        cronExpr = cadence;
        cadenceLabel = cadence;
      }
    }

    const store = getPromptJobStore();
    const job = store.createJob({
      name,
      prompt,
      agentId,
      projectId,
      provider: provider ?? 'claude',
      model,
      cliArgs,
      cronExpr: cronExpr || undefined,
      cadence: cadenceLabel || `every ${Math.round((checkEveryMs ?? 300000) / 60000)}m`,
      overlapPolicy,
      catchUpPolicy,
      cancelCheckSec,
      triggerType: effectiveTriggerType,
      condition,
      checkEveryMs,
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
