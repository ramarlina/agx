import { NextRequest, NextResponse } from 'next/server';
import { getPromptJobStore } from '@/src/prompt-scheduler/get-store';
import {
  normalizeLegacyConditionSchedule,
  parseCadence,
} from '@/src/prompt-scheduler/cron';
import { logger } from "@/lib/logger";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveScheduledPayload(input: {
  cadence?: unknown;
  triggerType?: unknown;
  checkEveryMs?: unknown;
}): { cadence: string; cronExpr: string } | null {
  if (typeof input.cadence === 'string') {
    const trimmed = input.cadence.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = parseCadence(trimmed);
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
 * GET /api/prompt-jobs/[id]
 * Get a single prompt job by id.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = getPromptJobStore();
    const job = store.getJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    return NextResponse.json({ job });
  } catch (error) {
    logger.error('Failed to get prompt job', logger.formatError(error));
    return NextResponse.json(
      { error: 'Failed to get prompt job', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/prompt-jobs/[id]
 * Update a prompt job. If cadence is provided, re-parse and update cronExpr + nextRunAt.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = getPromptJobStore();

    const existing = store.getJob(id);
    if (!existing) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const body = await req.json();
    const { cadence, triggerType, checkEveryMs, ...rest } = body;

    const updates: Record<string, unknown> = { ...rest };

    if (cadence === '') {
      return NextResponse.json(
        { error: 'Cadence cannot be cleared. Prompt jobs always require a schedule.' },
        { status: 400 },
      );
    }

    const scheduled = resolveScheduledPayload({ cadence, triggerType, checkEveryMs });
    if (scheduled) {
      updates.cadence = scheduled.cadence;
      updates.cronExpr = scheduled.cronExpr;
    } else if (cadence !== undefined) {
      return NextResponse.json(
        { error: `Could not parse cadence: "${cadence}". Provide a valid cron expression or natural language schedule.` },
        { status: 400 },
      );
    }

    const job = store.updateJob(id, updates);
    return NextResponse.json({ job });
  } catch (error) {
    logger.error('Failed to update prompt job', logger.formatError(error));
    return NextResponse.json(
      { error: 'Failed to update prompt job', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/prompt-jobs/[id]
 * Delete a prompt job.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = getPromptJobStore();

    const existing = store.getJob(id);
    if (!existing) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    store.deleteJob(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete prompt job', logger.formatError(error));
    return NextResponse.json(
      { error: 'Failed to delete prompt job', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
