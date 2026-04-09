import { NextRequest, NextResponse } from "next/server";

import { createAdminDbClient } from "@/lib/db-adapter";
import { getGraph } from "@/src/graph/store";
import type { ExecutionLifecycleState } from "@/src/graph/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/tasks/[id]/graph/pause
 *
 * Pause task execution. Freezes all running nodes and preserves state.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: taskId } = await params;

    const graph = getGraph(taskId);

    if (!graph) {
      return NextResponse.json(
        { error: "No execution graph found for this task" },
        { status: 404 }
      );
    }

    // Can only pause if running
    if (graph.executionState !== 'running') {
      return NextResponse.json(
        { error: "Can only pause a running task", executionState: graph.executionState },
        { status: 400 }
      );
    }

    const db = createAdminDbClient();

    // Pause all running nodes in graph_nodes table
    const pausableStatuses = ['running', 'awaiting_human'];
    const pausableTypes = ['work', 'gate', 'join', 'conditional', 'root'];

    const nodeIdsToPause = Object.entries(graph.nodes)
      .filter(([, node]) =>
        pausableStatuses.includes(node.status) && pausableTypes.includes(node.type)
      )
      .map(([nodeId]) => nodeId);

    if (nodeIdsToPause.length > 0) {
      for (const nodeId of nodeIdsToPause) {
        await db
          .from("graph_nodes")
          .update({ status: 'paused' })
          .eq("graph_id", graph.id)
          .eq("node_id", nodeId);
      }
    }

    // Update execution state to paused
    await db
      .from("execution_graphs")
      .update({
        execution_state: 'paused' as ExecutionLifecycleState,
      })
      .eq("id", graph.id);

    return NextResponse.json({
      success: true,
      executionState: 'paused' as ExecutionLifecycleState,
    });
  } catch (error) {
    console.error("Error pausing execution:", error);
    return NextResponse.json(
      { error: "Failed to pause execution" },
      { status: 500 }
    );
  }
}
