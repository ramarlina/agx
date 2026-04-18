import { NextRequest, NextResponse } from 'next/server';

import { getPromptJobStore } from '@/src/prompt-scheduler/get-store';
import { pollDueJobs } from '@/src/prompt-scheduler/engine';
import { requestPromptJobPump } from '@/src/prompt-scheduler/processor';
import { logger } from "@/lib/logger";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readPollRequestBody(req: NextRequest): Promise<{ jobId?: string }> {
  const rawBody = await req.text();
  if (!rawBody.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      logger.error('[prompt-jobs/poll] unexpected request body', { body: parsed });
      return {};
    }
    if ('jobId' in parsed && parsed.jobId != null && typeof parsed.jobId !== 'string') {
      logger.error('[prompt-jobs/poll] unexpected request body', { body: parsed });
      return {};
    }
    return parsed as { jobId?: string };
  } catch (err) {
    logger.error('[prompt-jobs/poll] failed to parse request body', logger.formatError(err));
    return {};
  }
}

/**
 * POST /api/prompt-jobs/poll
 *
 * This route only queues work and nudges the long-lived prompt-job pump.
 * Actual execution happens in the shared processor registered from instrumentation.ts.
 */
export async function POST(req: NextRequest) {
  try {
    const store = getPromptJobStore();
    const body = await readPollRequestBody(req);

    if (body.jobId) {
      const job = store.getJob(body.jobId);
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

      const run = store.createRun(job.id);
      requestPromptJobPump();
      return NextResponse.json({ queued: [run], skipped: [] });
    }

    const result = await pollDueJobs(store);
    requestPromptJobPump();
    return NextResponse.json({ queued: result.queued, skipped: result.skipped });
  } catch (error) {
    logger.error('Failed to poll prompt jobs', logger.formatError(error));
    return NextResponse.json(
      { error: 'Failed to poll prompt jobs', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
