import { NextRequest, NextResponse } from 'next/server';
import { getPromptJobStore } from '@/src/prompt-scheduler/get-store';
import { logger } from "@/lib/logger";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/prompt-jobs/[id]/runs
 * List runs for a given prompt job.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = getPromptJobStore();

    const job = store.getJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const runs = store.listRuns(id);
    return NextResponse.json({ count: runs.length, runs });
  } catch (error) {
    logger.error('Failed to list prompt runs', logger.formatError(error));
    return NextResponse.json(
      { error: 'Failed to list prompt runs', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
