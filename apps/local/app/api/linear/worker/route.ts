import { NextRequest, NextResponse } from 'next/server';
import { getPromptJobStore } from '@/src/prompt-scheduler/get-store';
import {
  LINEAR_WORKER_JOB_NAME,
  LINEAR_WORKER_DEFAULT_PROMPT,
  LINEAR_WORKER_DEFAULT_CADENCE,
  findLinearWorkerJob,
} from '@/src/prompt-scheduler/linear-worker-job';
import {
  computeNextRun,
  computePrevRun,
  parseCadence,
} from '@/src/prompt-scheduler/cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/linear/worker
 * Return the current linear worker config (the prompt job with executionMode === 'linear_worker').
 */
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get('projectId') ?? undefined;
    const job = findLinearWorkerJob(projectId);

    if (!job) {
      return NextResponse.json({ job: null });
    }

    const cronExpr = job.cronExpr || job.cadence;
    const prevScheduledAt = cronExpr ? computePrevRun(cronExpr) : null;

    return NextResponse.json({ job: { ...job, prevScheduledAt } });
  } catch (error) {
    console.error('Failed to get linear worker:', error);
    return NextResponse.json(
      { error: 'Failed to get linear worker', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/linear/worker
 * Create or update the linear worker prompt job.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      projectId,
      prompt,
      scriptPrompt,
      cadence,
      agentId,
      provider,
      model,
      state,
      teamId,
    } = body;

    const store = getPromptJobStore();
    const existing = findLinearWorkerJob(projectId);

    if (existing) {
      // Update existing
      const updates: Record<string, unknown> = {};
      if (typeof prompt === 'string') updates.prompt = prompt;
      if (typeof scriptPrompt === 'string') updates.scriptPrompt = scriptPrompt;
      if (typeof teamId === 'string') updates.teamId = teamId;
      if (typeof agentId === 'string') updates.agentId = agentId;
      if (typeof provider === 'string') updates.provider = provider;
      if (typeof model === 'string') updates.model = model;
      if (typeof state === 'string') updates.state = state;

      if (typeof cadence === 'string' && cadence.trim()) {
        const parsed = parseCadence(cadence.trim());
        if (parsed) {
          updates.cadence = parsed.cadence;
          updates.cronExpr = parsed.cronExpr;
        } else {
          return NextResponse.json(
            { error: `Could not parse cadence: "${cadence}"` },
            { status: 400 },
          );
        }
      }

      const job = store.updateJob(existing.id, updates);
      return NextResponse.json({ job });
    }

    // Create new
    const resolvedPrompt = typeof prompt === 'string' && prompt.trim()
      ? prompt
      : LINEAR_WORKER_DEFAULT_PROMPT;

    const resolvedCadence = typeof cadence === 'string' && cadence.trim()
      ? cadence
      : LINEAR_WORKER_DEFAULT_CADENCE;

    const job = store.createJob({
      name: LINEAR_WORKER_JOB_NAME,
      prompt: resolvedPrompt,
      scriptPrompt: typeof scriptPrompt === 'string' ? scriptPrompt : undefined,
      teamId: typeof teamId === 'string' ? teamId : undefined,
      executionMode: 'linear_worker',
      projectId: projectId || undefined,
      builtIn: true,
      cadence: resolvedCadence,
      provider: provider ?? 'claude',
      model,
      agentId,
    });

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    console.error('Failed to create/update linear worker:', error);
    return NextResponse.json(
      { error: 'Failed to create/update linear worker', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/linear/worker
 * Remove/disable the linear worker.
 */
export async function DELETE(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get('projectId') ?? undefined;
    const store = getPromptJobStore();
    const existing = findLinearWorkerJob(projectId);

    if (!existing) {
      return NextResponse.json({ error: 'Linear worker not found' }, { status: 404 });
    }

    // Pause instead of deleting since it's a built-in job
    const job = store.updateJob(existing.id, { state: 'paused' });
    return NextResponse.json({ success: true, job });
  } catch (error) {
    console.error('Failed to disable linear worker:', error);
    return NextResponse.json(
      { error: 'Failed to disable linear worker', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
