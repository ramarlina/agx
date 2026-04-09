import { NextRequest, NextResponse } from 'next/server';
import { getPromptJobStore } from '@/src/prompt-scheduler/get-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/prompt-jobs/[id]/cancel
 * Find the active run (running or queued) for the job and mark it cancelled.
 * Returns 404 if no active run exists.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = getPromptJobStore();

    const job = store.getJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Find active run (running or queued)
    const runs = store.listRuns(id);
    const activeRun = runs.find((r) => r.status === 'running' || r.status === 'queued');

    if (!activeRun) {
      return NextResponse.json({ error: 'No active run found for this job' }, { status: 404 });
    }

    const cancelledAt = new Date().toISOString();
    const updatedRun = store.updateRun(activeRun.id, {
      status: 'cancelled',
      cancelledAt,
    });

    return NextResponse.json({ run: updatedRun });
  } catch (error) {
    console.error('Failed to cancel prompt run:', error);
    return NextResponse.json(
      { error: 'Failed to cancel prompt run', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
