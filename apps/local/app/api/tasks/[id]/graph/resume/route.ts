import { NextRequest, NextResponse } from "next/server";

import { createAdminDbClient } from "@/lib/db-adapter";
import { LOCAL_USER } from "@/lib/auth-mode";
import type { ExecutionGraph, ExecutionLifecycleState } from "@/src/graph/types";
import { syncTaskProgressForGraphExecution } from "@/src/graph/task-lifecycle";

interface RouteParams {
  params: Promise<{ id: string }>;
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
    
    // Can only resume if paused or stopped
    if (graph.executionState !== 'paused' && graph.executionState !== 'stopped') {
      return NextResponse.json(
        { error: "Can only resume a paused or stopped task", executionState: graph.executionState },
        { status: 400 }
      );
    }
    
    // Resume all paused/stopped nodes that were running before
    const updatedNodes = { ...graph.nodes };
    for (const [nodeId, node] of Object.entries(updatedNodes)) {
      if (node.status === 'paused' || node.status === 'stopped') {
        // Check if node has startedAt but not completedAt - means it was in progress
        if (node.startedAt && !node.completedAt) {
          updatedNodes[nodeId] = { ...node, status: 'running' as const };
        } else {
          // Reset to pending so it can be picked up again
          updatedNodes[nodeId] = { ...node, status: 'pending' as const };
        }
      }
    }
    
    // Update execution state to running
    const { error: updateError } = await db
      .from("execution_graphs")
      .update({
        execution_state: 'running' as ExecutionLifecycleState,
        nodes: updatedNodes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", graph.id);
    
    if (updateError) {
      throw updateError;
    }
    
    // Update task status/stage so it reflects active execution.
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
    console.error("Error resuming execution:", error);
    return NextResponse.json(
      { error: "Failed to resume execution" },
      { status: 500 }
    );
  }
}
