/**
 * Task Processor - Replaces Temporal taskWorkflow
 *
 * This is the core state machine that processes task signals.
 * Stateless - all state is stored in the database.
 */

import type { Job } from "@/lib/queue/adapter";
import type { TaskStage } from "@/lib/db-adapter.interface";
import { db } from "@/lib/db-instance";
import { resolveStageTransition, resolveWorkflowTransition, type TicketType } from "@/lib/orchestration/stage-machine";
import {
    applyStageTransitionActivity,
    appendTaskCommentActivity,
    appendTaskLogActivity,
    dispatchStageActivity,
    markCancelledActivity,
    recordStageDecisionActivity,
} from "@/lib/orchestrator/activities";
import type {
    AgentDecisionSignalPayload,
    DaemonStepSignalPayload,
    HumanInputSignalPayload,
    TaskSignal,
} from "@/lib/orchestrator/types";

export interface TaskJobData {
    taskId: string;
    userId: string;
    signal: TaskSignal;
    payload?: AgentDecisionSignalPayload | HumanInputSignalPayload | DaemonStepSignalPayload | { reason?: string };
    ticketType?: TicketType;
}

/**
 * Main task processor - handles all task signals
 * Internal function that processes a single job
 */
async function processSingleJob(job: Job<TaskJobData>): Promise<void> {
    const { taskId, userId, signal, payload, ticketType = "task" } = job.data;

    // Load current task state from DB
    const task = await db.getTask(taskId, userId);
    if (!task) {
        console.log(`[processor] Task ${taskId} not found, skipping`);
        return;
    }

    // Early exit for terminal states
    if (task.status === "completed" || task.status === "failed") {
        console.log(`[processor] Task ${taskId} is ${task.status}, skipping`);
        return;
    }

    const currentStage = task.stage as TaskStage;

    switch (signal) {
        case "start":
            await handleStart(taskId, currentStage, userId);
            break;

        case "agentResult":
            await handleAgentResult(
                taskId,
                currentStage,
                userId,
                payload as AgentDecisionSignalPayload,
                ticketType,
                task.retry_count || 0,
                (task.workflow_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(task.workflow_id) ? task.workflow_id : null)
            );
            break;

        case "humanInput":
            await handleHumanInput(taskId, payload as HumanInputSignalPayload);
            break;

        case "daemonStep":
            await handleDaemonStep(taskId, payload as DaemonStepSignalPayload);
            break;

        case "cancel":
            await handleCancel(taskId, userId, (payload as { reason?: string })?.reason);
            break;

        default:
            console.warn(`[processor] Unknown signal: ${signal}`);
    }
}

/**
 * Batch handler — processes an array of jobs sequentially.
 */
export async function taskProcessor(jobs: Job<TaskJobData>[]): Promise<void> {
    for (const job of jobs) {
        try {
            await processSingleJob(job);
        } catch (error) {
            console.error(`[processor] Error processing job ${job.id}:`, error);
            throw error; // Re-throw to let queue adapter handle retry
        }
    }
}

async function handleStart(taskId: string, stage: TaskStage, userId: string): Promise<void> {
    console.log(`[processor] Starting task ${taskId} at stage ${stage}`);
    await dispatchStageActivity({ taskId, stage, userId });
    await appendTaskLogActivity({
        taskId,
        content: `Task started at stage: ${stage}`,
        logType: "system",
    });
}

async function handleAgentResult(
    taskId: string,
    currentStage: TaskStage,
    userId: string,
    decision: AgentDecisionSignalPayload,
    ticketType: TicketType,
    retryCount: number,
    workflowId: string | null = null
): Promise<void> {
    console.log(`[processor] Processing agent result for ${taskId}: ${decision.decision}`);

    // Record the decision
    await recordStageDecisionActivity({
        taskId,
        stage: currentStage,
        decision,
        userId,
    });

    // Extract and save comments
    const explicitComments = Array.isArray(decision.comments)
        ? decision.comments.map((entry) => String(entry || "").trim()).filter(Boolean)
        : [];
    const fallbackComment = String(decision.comment || decision.log || decision.final_result || "").trim();
    const normalizedComments =
        explicitComments.length > 0
            ? explicitComments
            : fallbackComment
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean);

    for (const content of normalizedComments) {
        await appendTaskCommentActivity({ taskId, content, authorType: "agent" });
    }

    // Calculate transition - use workflow-driven if workflow_id is set
    let nextStage: TaskStage;
    let nextStatus: string;
    let nextRetryCount: number;
    let transitionError: string | null = null;
    let appendLog: { content: string; logType: "checkpoint" | "system" | "error" } | null = null;

    if (workflowId) {
        // Use workflow-driven transition
        const workflowTransition = await resolveWorkflowTransition({
            workflowId,
            currentNodeName: currentStage,
            decision: decision.decision,
            retryCount,
            maxRetries: 3,
        });
        nextStage = workflowTransition.nextNodeName as TaskStage;
        nextStatus = workflowTransition.nextStatus;
        nextRetryCount = workflowTransition.retryCount;
        transitionError = workflowTransition.error;
        appendLog = workflowTransition.appendLog;
        console.log(`[processor] Workflow transition: ${currentStage} -> ${nextStage} (workflow: ${workflowId})`);
    } else {
        // Legacy: use fixed stage machine
        const transition = resolveStageTransition({
            currentStage,
            decision: decision.decision,
            ticketType,
            retryCount,
            maxRetries: 3,
        });
        nextStage = transition.nextStage;
        nextStatus = transition.nextStatus;
        nextRetryCount = transition.retryCount;
        transitionError = transition.error;
        appendLog = transition.appendLog;
    }

    // Apply transition
    await applyStageTransitionActivity({
        taskId,
        nextStage,
        nextStatus: nextStatus as any,
        retryCount: nextRetryCount,
        error: transitionError ? decision.explanation || transitionError : null,
        userId,
    });

    // Append log if needed
    if (appendLog) {
        const content =
            appendLog.logType === "error" && decision.explanation
                ? decision.explanation
                : appendLog.logType === "system" && decision.explanation
                    ? decision.explanation
                    : appendLog.content;

        await appendTaskLogActivity({
            taskId,
            content,
            logType: appendLog.logType,
        });
    }

    console.log(`[processor] Task ${taskId} transitioned: ${currentStage} -> ${nextStage}`);
}

async function handleHumanInput(taskId: string, payload: HumanInputSignalPayload): Promise<void> {
    console.log(`[processor] Recording human input for ${taskId}`);
    await appendTaskCommentActivity({
        taskId,
        content: payload.content,
        authorType: payload.authorType || "user",
    });
}

async function handleDaemonStep(taskId: string, step: DaemonStepSignalPayload): Promise<void> {
    const providerSuffix = step.provider ? ` provider=${step.provider}` : "";
    const modelSuffix = step.model ? ` model=${step.model}` : "";
    const roleSuffix = step.role ? ` role=${step.role}` : "";
    const iterationSuffix = typeof step.iteration === "number" ? ` iter=${step.iteration}` : "";
    const exitSuffix = step.phase === "exit" ? ` exit=${step.exit_code}` : "";
    const errorSuffix = step.error ? ` error=${step.error}` : "";
    const argsSummary = Array.isArray(step.args) ? step.args.join(" ") : "";
    const stdoutSummary = step.stdout_tail ? `\nstdout_tail:\n${step.stdout_tail}` : "";
    const stderrSummary = step.stderr_tail ? `\nstderr_tail:\n${step.stderr_tail}` : "";

    const content =
        `[execution/${step.kind || "daemon"}] ${step.phase || "event"} ${step.label || ""}${providerSuffix}${modelSuffix}${roleSuffix}${iterationSuffix}${exitSuffix}${errorSuffix}`.trim() +
        (argsSummary ? `\nargs: ${argsSummary}` : "") +
        (step.duration_ms ? `\nduration_ms: ${step.duration_ms}` : "") +
        stdoutSummary +
        stderrSummary;

    await appendTaskLogActivity({
        taskId,
        content,
        logType: "system",
    });
}

async function handleCancel(taskId: string, userId: string, reason?: string): Promise<void> {
    console.log(`[processor] Cancelling task ${taskId}: ${reason || "No reason"}`);
    await markCancelledActivity({ taskId, reason, userId });
}
