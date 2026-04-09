import { NextRequest, NextResponse } from "next/server";

import { createAdminDbClient } from "@/lib/db-adapter";
import { LOCAL_USER } from "@/lib/auth-mode";
import { getGraph } from "@/src/graph/store";
import type { ExecutionLifecycleState, GraphNode } from "@/src/graph/types";
import { syncTaskProgressForGraphExecution } from "@/src/graph/task-lifecycle";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/tasks/[id]/graph/restart
 *
 * Restart a completed task. Resets all non-root nodes to pending and
 * increments graph version.
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

    // Can only restart if done
    if (graph.executionState !== 'done') {
      return NextResponse.json(
        { error: "Can only restart a completed task", executionState: graph.executionState },
        { status: 400 }
      );
    }

    const db = createAdminDbClient();

    // Reset all non-root nodes to pending
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      if (node.type === 'root') continue;

      // Build reset node and split for storage
      const resetNode: GraphNode = {
        ...node,
        status: 'pending',
        startedAt: undefined,
        completedAt: undefined,
        actualMinutes: undefined,
        metrics: undefined,
      };

      if (resetNode.type === 'work') {
        resetNode.attempts = 0;
        resetNode.output = undefined;
      }

      if (resetNode.type === 'function') {
        resetNode.output = undefined;
      }

      if (resetNode.type === 'gate') {
        resetNode.verificationResult = undefined;
      }

      if (resetNode.type === 'conditional') {
        resetNode.evaluatedTo = undefined;
      }

      // Split node into storage columns (same logic as store.ts splitNodeForStorage)
      const { type: _type, status, metrics, output, ...config } = resetNode as GraphNode & { output?: Record<string, unknown> };

      await db
        .from("graph_nodes")
        .update({
          status,
          config: JSON.stringify(config),
          output: output ? JSON.stringify(output) : null,
          metrics: metrics ? JSON.stringify(metrics) : null,
        })
        .eq("graph_id", graph.id)
        .eq("node_id", nodeId);
    }

    // Update execution state to running and increment version
    await db
      .from("execution_graphs")
      .update({
        execution_state: 'running' as ExecutionLifecycleState,
        graph_version: graph.graphVersion + 1,
      })
      .eq("id", graph.id);

    // Queue task so daemon picks up rerun
    await syncTaskProgressForGraphExecution({
      taskId,
      userId,
      status: "queued",
      nowIso: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      clearError: true,
    });

    return NextResponse.json({
      success: true,
      executionState: 'running' as ExecutionLifecycleState,
      graphVersion: graph.graphVersion + 1,
    });
  } catch (error) {
    console.error("Error restarting execution:", error);
    return NextResponse.json(
      { error: "Failed to restart execution" },
      { status: 500 }
    );
  }
}
