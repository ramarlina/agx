import { NextRequest, NextResponse } from 'next/server';
import { pollSchedules, executeScheduleTick } from '@/src/graph/schedule-runner';
import { createDispatchFunction } from '@/src/graph/function-executor';
import { createDispatchWork } from '@/src/graph/work-dispatcher';
import { logger } from "@/lib/logger";
import { parseBody } from "@/lib/parse-body";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/schedules/poll
 *
 * Poll all graphs with active schedules and execute due ticks.
 * This endpoint can be called by an external scheduler/cron job.
 *
 * Request body (optional):
 * - taskId: If provided, poll only that specific task's schedule
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const dispatchFunction = createDispatchFunction();
    const dispatchWork = createDispatchWork();

    if (body.taskId) {
      // Poll a specific task
      const result = await executeScheduleTick(body.taskId, { dispatchFunction, dispatchWork });

      if (!result.fired) {
        const schedule = result.graph?.schedule;
        const atCapacity = schedule && (schedule.currentConcurrency ?? 0) >= (schedule.maxConcurrency ?? 5);
        const skipReason = atCapacity ? 'max_concurrency_reached' : 'not_due';
        return NextResponse.json({
          success: false,
          taskId: body.taskId,
          skipReason,
          error: result.error?.message ?? null,
        }, { status: 409 });
      }

      return NextResponse.json({
        success: true,
        taskId: body.taskId,
      });
    }

    // Poll all active schedules
    const result = await pollSchedules({ dispatchFunction, dispatchWork });

    return NextResponse.json({
      success: true,
      tickedGraphIds: result.tickedGraphIds,
      skippedGraphIds: result.skippedGraphIds,
      errorCount: result.errors.length,
      errors: result.errors.length > 0
        ? result.errors.map((e) => ({ graphId: e.graphId, message: e.error.message }))
        : undefined,
    });
  } catch (error) {
    logger.error('Schedule poll error', logger.formatError(error));
    return NextResponse.json(
      { error: 'Failed to poll schedules', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * GET /api/schedules/poll
 *
 * List all graphs with active schedules (for debugging/monitoring).
 */
export async function GET() {
  try {
    const { getGraphsWithActiveSchedules } = await import('@/src/graph/schedule-runner');
    const schedules = getGraphsWithActiveSchedules();

    return NextResponse.json({
      count: schedules.length,
      schedules: schedules.map((s) => ({
        taskId: s.taskId,
        graphId: s.graphId,
        state: s.schedule.state,
        intervalMs: s.schedule.intervalMs,
        runCount: s.schedule.runCount,
        lastTickAt: s.schedule.lastTickAt,
        tickInProgress: s.schedule.tickInProgress,
        currentConcurrency: s.schedule.currentConcurrency ?? 0,
        maxConcurrency: s.schedule.maxConcurrency ?? 5,
      })),
    });
  } catch (error) {
    logger.error('Failed to list schedules', logger.formatError(error));
    return NextResponse.json(
      { error: 'Failed to list schedules' },
      { status: 500 },
    );
  }
}
