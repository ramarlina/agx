/**
 * Cancel Task API Route
 * POST /api/orchestrator/tasks/[taskId]/cancel
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminDbClient } from "@/lib/db-adapter";
import { getQueue, QUEUE_NAMES } from "@/lib/queue/boss";
import { appendWorkflowEvent } from "@/lib/orchestrator/events";
import { requireUserId } from "@/lib/api/auth";
import type { TaskJobData } from "@/lib/orchestrator/processor";
import { logger } from "@/lib/logger";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
) {
    try {
        const auth = await requireUserId(request);

        const { taskId } = await params;
        const body = await request.json().catch(() => ({}));
        const reason = typeof body.reason === "string" ? body.reason : undefined;

        // Enqueue cancel job
        const queue = await getQueue();
        const jobId = await queue.send(QUEUE_NAMES.TASK_PROCESS, {
            taskId,
            userId: auth.userId,
            signal: "cancel",
            payload: { reason },
        });

        // Update task timestamp
        const adminDb = createAdminDbClient();
        await adminDb
            .from("tasks")
            .update({
                updated_at: new Date().toISOString(),
            })
            .eq("id", taskId)
            .eq("user_id", auth.userId);

        // Log event
        await appendWorkflowEvent({
            taskId,
            userId: auth.userId,
            eventType: "task.cancelled",
            payload: reason ? { reason } : {},
            jobId: jobId || undefined,
        });

        return NextResponse.json({ ok: true, jobId });
    } catch (error) {
        logger.error("Failed to cancel task", logger.formatError(error));
        return NextResponse.json({ error: "Failed to cancel task" }, { status: 500 });
    }
}
