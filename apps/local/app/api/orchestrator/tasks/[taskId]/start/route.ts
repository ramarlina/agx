/**
 * Start Task API Route
 * POST /api/orchestrator/tasks/[taskId]/start
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-instance";
import { parseFrontmatter } from "@/lib/db";
import type { TaskStage } from "@/lib/db-adapter.interface";
import { createAdminDbClient } from "@/lib/db-adapter";
import { getTicketType } from "@/lib/orchestration/stage-machine";
import { getQueue, QUEUE_NAMES } from "@/lib/queue/boss";
import { appendWorkflowEvent } from "@/lib/orchestrator/events";
import { LOCAL_USER } from "@/lib/auth-mode";
import type { TaskJobData } from "@/lib/orchestrator/processor";
import { logger } from "@/lib/logger";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
) {
    try {
        const userId = LOCAL_USER.id;

        const { taskId } = await params;
        const task = await db.getTask(taskId, userId);
        if (!task) {
            return NextResponse.json({ error: "Task not found" }, { status: 404 });
        }

        const { frontmatter, body: markdownBody } = parseFrontmatter(task.content);
        const stage = ((task.stage || frontmatter.stage || "INTAKE") as TaskStage);
        const ticketType = getTicketType(frontmatter, markdownBody);

        // Enqueue job with QueueAdapter
        const queue = await getQueue();
        const jobId = await queue.send(QUEUE_NAMES.TASK_PROCESS, {
            taskId,
            userId,
            signal: "start",
            ticketType,
        });

        // Update task metadata
        const adminDb = createAdminDbClient();
        await adminDb
            .from("tasks")
            .update({
                status: "queued",
                updated_at: new Date().toISOString(),
            })
            .eq("id", taskId)
            .eq("user_id", userId);

        // Log event
        await appendWorkflowEvent({
            taskId,
            userId,
            eventType: "task.started",
            payload: { stage, ticketType },
            jobId: jobId || undefined,
        });

        return NextResponse.json({ jobId, taskId, started: true }, { status: 202 });
    } catch (error) {
        logger.error("Failed to start task", logger.formatError(error));
        return NextResponse.json({ error: "Failed to start task" }, { status: 500 });
    }
}
