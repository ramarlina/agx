/**
 * Signal Task API Route
 * POST /api/orchestrator/tasks/[taskId]/signal
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminDbClient } from "@/lib/db-adapter";
import { getQueue, QUEUE_NAMES } from "@/lib/queue/boss";
import { appendWorkflowEvent } from "@/lib/orchestrator/events";
import { requireUserId } from "@/lib/api/auth";
import type { StageDecision } from "@/lib/orchestration/stage-machine";
import type { TaskJobData } from "@/lib/orchestrator/processor";
import type {
    AgentDecisionSignalPayload,
    DaemonStepSignalPayload,
    HumanInputSignalPayload,
} from "@/lib/orchestrator/types";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
) {
    try {
        const auth = await requireUserId(request);

        const { taskId } = await params;
        const body = await request.json().catch(() => ({}));
        const signal = String(body?.signal || "");
        const rawPayload = body?.payload || {};

        if (!signal) {
            return NextResponse.json({ error: "signal is required" }, { status: 400 });
        }

        const queue = await getQueue();
        let jobId: string | null = null;

        // CLI compatibility: stop -> cancel, nudge -> humanInput
        if (signal === "stop") {
            const reason = typeof rawPayload.reason === "string" ? rawPayload.reason : "Stopped from CLI";
            jobId = await queue.send(QUEUE_NAMES.TASK_PROCESS, {
                taskId,
                userId: auth.userId,
                signal: "cancel",
                payload: { reason },
            });
        } else if (signal === "nudge") {
            const message = typeof rawPayload.message === "string" && rawPayload.message.trim()
                ? rawPayload.message.trim()
                : "Nudge from CLI";
            jobId = await queue.send(QUEUE_NAMES.TASK_PROCESS, {
                taskId,
                userId: auth.userId,
                signal: "humanInput",
                payload: { content: message, authorType: "user" } as HumanInputSignalPayload,
            });
        } else if (signal === "agentResult") {
            const decisionValue = typeof rawPayload.decision === "string" ? rawPayload.decision.trim() : "";
            const explanationValue = typeof rawPayload.explanation === "string" ? rawPayload.explanation.trim() : "";
            const finalResultValue = typeof rawPayload.final_result === "string" ? rawPayload.final_result.trim() : "";
            const allowedDecisions: StageDecision[] = ["done", "blocked", "not_done", "failed"];

            if (
                !allowedDecisions.includes(decisionValue as StageDecision) ||
                !explanationValue ||
                !finalResultValue
            ) {
                return NextResponse.json({ error: "Invalid agentResult payload" }, { status: 400 });
            }

            const comments = Array.isArray(rawPayload.comments)
                ? rawPayload.comments.map((entry: unknown) => String(entry || "").trim()).filter(Boolean)
                : undefined;

            const commentValue = typeof rawPayload.comment === "string" ? rawPayload.comment.trim() : "";
            const logValue = typeof rawPayload.log === "string" ? rawPayload.log.trim() : "";

            const normalizedPayload: AgentDecisionSignalPayload = {
                decision: decisionValue as StageDecision,
                explanation: explanationValue,
                final_result: finalResultValue,
                comments,
                comment: commentValue || logValue || finalResultValue,
                log: logValue || undefined,
            };

            jobId = await queue.send(QUEUE_NAMES.TASK_PROCESS, {
                taskId,
                userId: auth.userId,
                signal: "agentResult",
                payload: normalizedPayload,
            });
        } else if (signal === "humanInput") {
            jobId = await queue.send(QUEUE_NAMES.TASK_PROCESS, {
                taskId,
                userId: auth.userId,
                signal: "humanInput",
                payload: rawPayload as HumanInputSignalPayload,
            });
        } else if (signal === "daemonStep") {
            jobId = await queue.send(QUEUE_NAMES.TASK_PROCESS, {
                taskId,
                userId: auth.userId,
                signal: "daemonStep",
                payload: rawPayload as DaemonStepSignalPayload,
            });
        } else if (signal === "cancel") {
            jobId = await queue.send(QUEUE_NAMES.TASK_PROCESS, {
                taskId,
                userId: auth.userId,
                signal: "cancel",
                payload: rawPayload,
            });
        } else {
            return NextResponse.json({ error: `Unsupported signal: ${signal}` }, { status: 400 });
        }

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
            eventType: `signal.${signal}`,
            payload: { signal },
            jobId: jobId || undefined,
        });

        return NextResponse.json({ ok: true, jobId });
    } catch (error) {
        console.error("Failed to signal task:", error);
        return NextResponse.json({ error: "Failed to signal task" }, { status: 500 });
    }
}
