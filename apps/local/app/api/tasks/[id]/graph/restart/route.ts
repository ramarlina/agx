import { NextRequest, NextResponse } from "next/server";

import { createAdminDbClient } from "@/lib/db-adapter";
import { LOCAL_USER } from "@/lib/auth-mode";
import type { ExecutionGraph, ExecutionLifecycleState, GraphNode } from "@/src/graph/types";
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
    
    const db = createAdminDbClient();
    
    // Get the current graph
    const { data: graphData, error: graphError } = await db
      .from("execution_graphs")
      .select("*")
      .eq("task_id", taskId)
      .single();
    
    if (graphError || !graphData) {
      return NextResponse.json(
        { error: "No execution graph found for this task" },
        { status: 404 }
      );
    }
    
    const graph = graphData as unknown as ExecutionGraph;
    
    // Can only restart if done
    if (graph.executionState !== 'done') {
      return NextResponse.json(
        { error: "Can only restart a completed task", executionState: graph.executionState },
        { status: 400 }
      );
    }
    
    // Reset all nodes to pending (except root which stays done)
    const updatedNodes = { ...graph.nodes };
    for (const [nodeId, node] of Object.entries(updatedNodes)) {
      if (node.type !== 'root') {
        const resetNode: GraphNode = {
          ...node,
          status: 'pending',
          startedAt: undefined,
          completedAt: undefined,
          actualMinutes: undefined,
        };
        
        // Reset work node attempts
        if (resetNode.type === 'work') {
          resetNode.attempts = 0;
          resetNode.output = undefined;
        }

        if (resetNode.type === 'function') {
          resetNode.output = undefined;
        }
        
        // Reset gate verification
        if (resetNode.type === 'gate') {
          resetNode.verificationResult = undefined;
        }
        
        updatedNodes[nodeId] = resetNode;
      }
    }
    
    // Update execution state to running and increment version
    const { error: updateError } = await db
      .from("execution_graphs")
      .update({
        execution_state: 'running' as ExecutionLifecycleState,
        graph_version: graph.graphVersion + 1,
        nodes: updatedNodes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", graph.id);
    
    if (updateError) {
      throw updateError;
    }
    
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
