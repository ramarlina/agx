import { NextRequest, NextResponse } from "next/server";

import { createAdminDbClient } from "@/lib/db-adapter";
import { LOCAL_USER } from "@/lib/auth-mode";
import type { ExecutionGraph, ExecutionLifecycleState } from "@/src/graph/types";

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
    
    // Can only pause if running
    if (graph.executionState !== 'running') {
      return NextResponse.json(
        { error: "Can only pause a running task", executionState: graph.executionState },
        { status: 400 }
      );
    }
    
    // Pause all running nodes (only work, gate, join, conditional support pause)
    const updatedNodes: typeof graph.nodes = { ...graph.nodes };
    for (const [nodeId, node] of Object.entries(updatedNodes)) {
      if (node.status === 'running' && (node.type === 'work' || node.type === 'gate' || node.type === 'join' || node.type === 'conditional' || node.type === 'root')) {
        (updatedNodes[nodeId] as any) = { ...node, status: 'paused' };
      }
    }
    
    // Update execution state to paused
    const { error: updateError } = await db
      .from("execution_graphs")
      .update({
        execution_state: 'paused' as ExecutionLifecycleState,
        nodes: updatedNodes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", graph.id);
    
    if (updateError) {
      throw updateError;
    }
    
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
