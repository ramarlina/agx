import { NextRequest, NextResponse } from "next/server";

import { createAdminDbClient } from "@/lib/db-adapter";
import { LOCAL_USER } from "@/lib/auth-mode";
import { syncTaskProgressForGraphExecution } from "@/src/graph/task-lifecycle";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/tasks/[id]/graph/start
 *
 * Queue a task for execution. Sets execution_state to 'running' and task
 * status to 'queued' so the CLI daemon picks it up.
 *
 * The daemon sees root.graphCreated === false and runs the LLM planner to
 * generate the full execution graph as a draft. The plan-approval gate then
 * blocks until a human approves the plan in the UI.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: taskId } = await params;
    const userId = LOCAL_USER.id;

    const db = createAdminDbClient();

    // Get the current graph
    const { data: graphData, error: graphError } = await db
      .from("execution_graphs")
      .select("id, execution_state")
      .eq("task_id", taskId)
      .single();

    if (graphError || !graphData) {
      return NextResponse.json(
        { error: "No execution graph found for this task" },
        { status: 404 },
      );
    }

    if (graphData.execution_state === "running") {
      return NextResponse.json(
        { error: "Task is already running", executionState: "running" },
        { status: 400 },
      );
    }

    // Set graph execution state to running
    const { error: updateError } = await db
      .from("execution_graphs")
      .update({ execution_state: "running" })
      .eq("id", graphData.id);

    if (updateError) {
      throw updateError;
    }

    // Queue the task so the daemon picks it up via GET /api/queue
    const now = new Date().toISOString();
    await syncTaskProgressForGraphExecution({
      taskId,
      userId,
      status: "queued",
      nowIso: now,
      completedAt: null,
      clearError: true,
    });

    return NextResponse.json({
      success: true,
      executionState: "running",
    });
  } catch (error) {
    console.error("Error starting execution:", error);
    return NextResponse.json(
      { error: "Failed to start execution" },
      { status: 500 },
    );
  }
}
