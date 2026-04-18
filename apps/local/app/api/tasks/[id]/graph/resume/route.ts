import { NextRequest, NextResponse } from "next/server";

import { createAdminDbClient } from "@/lib/db-adapter";
import { LOCAL_USER } from "@/lib/auth-mode";
import { getGraph } from "@/src/graph/store";
import type { ExecutionLifecycleState } from "@/src/graph/types";
import { syncTaskProgressForGraphExecution } from "@/src/graph/task-lifecycle";
import { logger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function resolveResumedStatus(node: {
  type: string;
  startedAt?: string;
  completedAt?: string;
  verificationResult?: unknown;
}) {
  const wasAwaitingHuman =
    node.type === "gate" && Boolean(node.verificationResult) && Boolean(node.startedAt) && !node.completedAt;

  if (wasAwaitingHuman) {
    return "awaiting_human";
  }

  return node.startedAt && !node.completedAt ? "running" : "pending";
}

/**
 * POST /api/tasks/[id]/graph/resume
 *
 * Resume paused or stopped task execution.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: taskId } = await params;
    const userId = LOCAL_USER.id;

    const graph = getGraph(taskId);

    if (!graph) {
      return NextResponse.json(
        { error: "No execution graph found for this task" },
        { status: 404 }
      );
    }

    // Can only resume if paused or stopped
    if (graph.executionState !== 'paused' && graph.executionState !== 'stopped') {
      return NextResponse.json(
        { error: "Can only resume a paused or stopped task", executionState: graph.executionState },
        { status: 400 }
      );
    }

    const db = createAdminDbClient();

    // Resume paused/stopped nodes in graph_nodes table
    const resumableStatuses = ['paused', 'stopped'];
    const resumableTypes = ['work', 'gate', 'join', 'conditional', 'root'];

    const nodesToResume = Object.entries(graph.nodes)
      .filter(([, node]) =>
        resumableStatuses.includes(node.status) && resumableTypes.includes(node.type)
      );

    for (const [nodeId, node] of nodesToResume) {
      const newStatus = resolveResumedStatus(node);
      await db
        .from("graph_nodes")
        .update({ status: newStatus })
        .eq("graph_id", graph.id)
        .eq("node_id", nodeId);
    }

    // Update execution state to running
    await db
      .from("execution_graphs")
      .update({
        execution_state: 'running' as ExecutionLifecycleState,
      })
      .eq("id", graph.id);

    // Update task status/stage so it reflects active execution
    await syncTaskProgressForGraphExecution({
      taskId,
      userId,
      status: "in_progress",
      nowIso: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      executionState: 'running' as ExecutionLifecycleState,
    });
  } catch (error) {
    logger.error("Error resuming execution", logger.formatError(error));
    return NextResponse.json(
      { error: "Failed to resume execution" },
      { status: 500 }
    );
  }
}
