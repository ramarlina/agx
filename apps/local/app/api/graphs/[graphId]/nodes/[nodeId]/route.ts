import { NextRequest, NextResponse } from "next/server";
import { getGraph } from "@/src/graph/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/graphs/:graphId/nodes/:nodeId
 * Returns a single node's state from a graph (used by act node to read steer output).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ graphId: string; nodeId: string }> },
) {
  const { graphId, nodeId } = await params;

  // Graph taskId is derived from graphId: "sched-<rootMessageId>" → taskId = rootMessageId
  const taskId = graphId.replace(/^sched-/, "");
  const graph = getGraph(taskId);

  if (!graph) {
    return NextResponse.json({ error: "Graph not found" }, { status: 404 });
  }

  const node = graph.nodes[nodeId];
  if (!node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  return NextResponse.json({ nodeId, ...node });
}
