/**
 * Task orchestration activities - migrated from Temporal activities
 * These are standard async functions with no Temporal context dependency
 */

import {
    parseFrontmatter,
} from "@/lib/db";
import {
    extractAndStoreMemories,
    extractAndStoreProjectKnowledge,
    resolveMemoryAgentId,
} from "@/lib/memory-extractor";
import type { TaskStage, TaskStatus } from "@/lib/db-adapter.interface";
import { db as dbAdapter } from "@/lib/db-instance";
import { createAdminDbClient } from "@/lib/db-adapter";
import { buildMarkdownWithFrontmatter } from "@/lib/orchestration/frontmatter";
import type { AgentDecisionSignalPayload } from "@/lib/orchestrator/types";
import { triggerDependentTasks } from "@/lib/dependency-manager";
import { notifyTaskEvent } from "@/lib/notifications";

function isMissingStageDecisionsError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const code = "code" in error ? String(error.code) : "";
    const message = "message" in error ? String(error.message).toLowerCase() : "";
    return (code === "PGRST204" || code === "42703") && message.includes("stage_decisions");
}

export async function dispatchStageActivity(input: {
    taskId: string;
    stage: TaskStage;
    userId: string;
}): Promise<void> {
    const db = createAdminDbClient();
    await db
        .from("tasks")
        .update({
            stage: input.stage,
            status: "queued",
            updated_at: new Date().toISOString(),
        })
        .eq("id", input.taskId)
        .eq("user_id", input.userId);
}

export async function recordStageDecisionActivity(input: {
    taskId: string;
    stage: TaskStage;
    decision: AgentDecisionSignalPayload;
    userId: string;
}): Promise<void> {
    const db = createAdminDbClient();
    const { data: task } = await db
        .from("tasks")
        .select("stage_decisions")
        .eq("id", input.taskId)
        .eq("user_id", input.userId)
        .maybeSingle();

    const existingStageDecisions =
        task?.stage_decisions && typeof task.stage_decisions === "object" ? task.stage_decisions : {};

    const nextStageDecisions = {
        ...existingStageDecisions,
        [input.stage]: {
            decision: input.decision.decision,
            rationale: input.decision.explanation,
            final_result: input.decision.final_result,
            decided_at: new Date().toISOString(),
        },
    };

    const { error } = await db
        .from("tasks")
        .update({
            stage_decisions: nextStageDecisions,
            updated_at: new Date().toISOString(),
        })
        .eq("id", input.taskId)
        .eq("user_id", input.userId);

    if (error && !isMissingStageDecisionsError(error)) {
        throw error;
    }
}

export async function applyStageTransitionActivity(input: {
    taskId: string;
    nextStage: TaskStage;
    nextStatus: TaskStatus;
    retryCount: number;
    error: string | null;
    userId: string;
}): Promise<void> {
    const task = await dbAdapter.getTask(input.taskId, input.userId);
    if (!task) {
        throw new Error(`Task ${input.taskId} not found`);
    }
    const previousStage = (task.stage as TaskStage) || null;
    const eventTimestamp = new Date().toISOString();
    const baseNotification = {
        taskId: input.taskId,
        userId: input.userId,
        title: task.title || null,
        slug: task.slug || null,
        timestamp: eventTimestamp,
    };

    const { frontmatter, body } = parseFrontmatter(task.content);
    const memoryAgentId = resolveMemoryAgentId({
        defaultUserId: input.userId,
        frontmatter: frontmatter as Record<string, unknown>,
    });
    frontmatter.stage = input.nextStage;
    frontmatter.status = input.nextStatus;
    if (input.error) {
        frontmatter.error = input.error;
    } else if ("error" in frontmatter) {
        delete frontmatter.error;
    }

    const updatedContent = buildMarkdownWithFrontmatter(frontmatter, body);
    await dbAdapter.updateTask(input.taskId, updatedContent, input.userId);

    const db = createAdminDbClient();
    const { error: directUpdateError } = await db
        .from("tasks")
        .update({
            stage: input.nextStage,
            status: input.nextStatus,
            retry_count: input.retryCount,
            error: input.error,
            updated_at: new Date().toISOString(),
        })
        .eq("id", input.taskId)
        .eq("user_id", input.userId);
    if (directUpdateError) {
        console.error(`[applyStageTransition] direct update failed for ${input.taskId}:`, directUpdateError);
    } else {
        console.log(`[applyStageTransition] set ${input.taskId} to status=${input.nextStatus}, stage=${input.nextStage}`);
    }

    if (input.nextStatus === "completed") {
        await db
            .from("tasks")
            .update({ completed_at: new Date().toISOString() })
            .eq("id", input.taskId)
            .eq("user_id", input.userId);
        await triggerDependentTasks(input.taskId, input.userId);
    }

    // Fire-and-forget memory extraction on terminal transitions
    if (input.nextStatus === "completed" || input.nextStatus === "failed") {
        extractAndStoreMemories(input.taskId, memoryAgentId, {
            goal: String(task.content || task.title || ""),
            status: String(input.nextStatus),
        }).catch((err) =>
            console.warn("[applyStageTransition] Memory extraction failed:", err)
        );
        extractAndStoreProjectKnowledge(input.taskId, task.project_id || task.project, {
            goal: String(task.content || task.title || ""),
            status: String(input.nextStatus),
        }).catch((err) =>
            console.warn("[applyStageTransition] Project knowledge extraction failed:", err)
        );
    }

    const shouldEmitStageComplete =
        input.nextStatus !== "blocked" && input.nextStatus !== "failed";

    if (shouldEmitStageComplete) {
        void notifyTaskEvent({
            ...baseNotification,
            eventType: "task.stage_complete",
            stage: previousStage,
            previousStage,
            nextStage: input.nextStage,
            status: input.nextStatus,
            details: { nextStatus: input.nextStatus },
        });
    }

    if (input.nextStatus === "completed") {
        void notifyTaskEvent({
            ...baseNotification,
            eventType: "task.completed",
            stage: input.nextStage,
            status: input.nextStatus,
            details: {
                previousStage: previousStage,
                nextStage: input.nextStage,
            },
        });
    }

    if (input.nextStatus === "failed") {
        void notifyTaskEvent({
            ...baseNotification,
            eventType: "task.failed",
            stage: input.nextStage,
            status: input.nextStatus,
            error: input.error,
            details: {
                previousStage,
            },
        });
    }
}

export async function appendTaskLogActivity(input: {
    taskId: string;
    content: string;
    logType?: string;
}): Promise<void> {
    await dbAdapter.addTaskLog(input.taskId, input.content, input.logType);
}

export async function appendTaskCommentActivity(input: {
    taskId: string;
    content: string;
    authorType?: "user" | "agent";
}): Promise<void> {
    await dbAdapter.addTaskComment(input.taskId, input.content, input.authorType || "agent");
}

export async function markCancelledActivity(input: {
    taskId: string;
    reason?: string;
    userId: string;
}): Promise<void> {
    const task = await dbAdapter.getTask(input.taskId, input.userId);
    if (!task) return;

    const { frontmatter, body } = parseFrontmatter(task.content);
    const memoryAgentId = resolveMemoryAgentId({
        defaultUserId: input.userId,
        frontmatter: frontmatter as Record<string, unknown>,
    });
    frontmatter.status = "failed";
    frontmatter.error = input.reason || "Cancelled";
    const updatedContent = buildMarkdownWithFrontmatter(frontmatter, body);

    await dbAdapter.updateTask(input.taskId, updatedContent, input.userId);
    await dbAdapter.addTaskLog(input.taskId, input.reason || "Task cancelled", "error");

    // Fire-and-forget memory extraction on cancellation
    extractAndStoreMemories(input.taskId, memoryAgentId, {
        goal: String(task.content || task.title || ""),
        status: "failed",
    }).catch((err) =>
        console.warn("[markCancelled] Memory extraction failed:", err)
    );
    extractAndStoreProjectKnowledge(input.taskId, task.project_id || task.project, {
        goal: String(task.content || task.title || ""),
        status: "failed",
    }).catch((err) =>
        console.warn("[markCancelled] Project knowledge extraction failed:", err)
    );

    const db = createAdminDbClient();
    await db
        .from("tasks")
        .update({
            status: "failed",
            error: input.reason || "Cancelled",
            updated_at: new Date().toISOString(),
        })
        .eq("id", input.taskId)
        .eq("user_id", input.userId);

    void notifyTaskEvent({
        taskId: input.taskId,
        userId: input.userId,
        eventType: "task.failed",
        title: task.title || null,
        slug: task.slug || null,
        stage: task.stage || null,
        status: "failed",
        error: input.reason || "Cancelled",
        timestamp: new Date().toISOString(),
        details: {
            previousStage: task.stage || null,
        },
    });
}
