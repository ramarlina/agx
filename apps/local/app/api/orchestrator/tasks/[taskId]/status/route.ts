/**
 * Query Task Status API Route
 * GET/POST /api/orchestrator/tasks/[taskId]/status
 *
 * Status is read directly from the database
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-instance";
import { requireUserId } from "@/lib/api/auth";
import type { WorkflowStatus } from "@/lib/orchestrator/types";
import type { StageDecision } from "@/lib/orchestration/stage-machine";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
) {
    return handleQuery(request, params);
}

// POST for backward compatibility with CLI
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
) {
    return handleQuery(request, params);
}

async function handleQuery(
    request: NextRequest,
    params: Promise<{ taskId: string }>
): Promise<NextResponse> {
    try {
        const auth = await requireUserId(request);

        const { taskId } = await params;
        const task = await db.getTask(taskId, auth.userId);

        if (!task) {
            return NextResponse.json({ error: "Task not found" }, { status: 404 });
        }

        // Get last decision from stage_decisions if available
        let lastDecision: StageDecision | null = null;
        if (task.stage_decisions && typeof task.stage_decisions === "object") {
            const decisions = task.stage_decisions as Record<string, { decision?: string }>;
            const stages = Object.keys(decisions);
            if (stages.length > 0) {
                const lastStage = stages[stages.length - 1];
                lastDecision = (decisions[lastStage]?.decision as StageDecision) || null;
            }
        }

        const status: WorkflowStatus = {
            taskId: task.id,
            stage: task.stage || "INTAKE",
            attempts: task.retry_count || 0,
            blocked: task.status === "blocked",
            cancelled: task.status === "failed" && Boolean(task.error?.includes("Cancel")),
            cancelReason: task.status === "failed" ? task.error : undefined,
            lastDecision,
            updatedAt: task.updated_at,
        };

        return NextResponse.json({ status, result: status });
    } catch (error) {
        console.error("Failed to query task status:", error);
        return NextResponse.json({ error: "Failed to query task status" }, { status: 500 });
    }
}
