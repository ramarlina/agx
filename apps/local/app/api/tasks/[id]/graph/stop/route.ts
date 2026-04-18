import { NextRequest, NextResponse } from "next/server";

import { createAdminDbClient } from "@/lib/db-adapter";
import { LOCAL_USER } from "@/lib/auth-mode";
import { getGraph } from "@/src/graph/store";
import type { ExecutionLifecycleState } from "@/src/graph/types";
import { logger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/tasks/[id]/graph/stop
 *
 * Stop task execution. Halts everything and preserves state.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: taskId } = await params;
    const userId = LOCAL_USER.id;

    const graph = await getGraph(taskId);

    if (!graph) {
      return NextResponse.json(
        { error: "No execution graph found for this task" },
        { status: 404 }
      );
    }

    // Can't stop if already stopped or done
    if (graph.executionState === 'stopped' || graph.executionState === 'done') {
      return NextResponse.json(
        { error: "Task is already stopped or done", executionState: graph.executionState },
        { status: 400 }
      );
    }

    const db = createAdminDbClient();

    // Stop all running/paused nodes in graph_nodes table
    const stoppableStatuses = ['running', 'paused'];
    const stoppableTypes = ['work', 'gate', 'join', 'conditional', 'root'];

    const nodeIdsToStop = Object.entries(graph.nodes)
      .filter(([, node]) =>
        stoppableStatuses.includes(node.status) && stoppableTypes.includes(node.type)
      )
      .map(([nodeId]) => nodeId);

    if (nodeIdsToStop.length > 0) {
      // Update each stoppable node's status in graph_nodes
      for (const nodeId of nodeIdsToStop) {
        await db
          .from("graph_nodes")
          .update({ status: 'stopped' })
          .eq("graph_id", graph.id)
          .eq("node_id", nodeId);
      }
    }

    // Update execution state to stopped
    await db
      .from("execution_graphs")
      .update({
        execution_state: 'stopped' as ExecutionLifecycleState,
      })
      .eq("id", graph.id);

    // Update task status to blocked
    await db
      .from("tasks")
      .update({
        status: 'blocked',
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId)
      .eq("user_id", userId);

    return NextResponse.json({
      success: true,
      executionState: 'stopped' as ExecutionLifecycleState,
    });
  } catch (error) {
    logger.error("Error stopping execution", logger.formatError(error));
    return NextResponse.json(
      { error: "Failed to stop execution" },
      { status: 500 }
    );
  }
}
