import { NextRequest, NextResponse } from "next/server";

import {
  normalizeTaskId,
} from "@/src/graph/api-route-utils";
import { authorizeGraphMutation } from "@/src/graph/middleware/authz";
import { getGraph, getGraphEvents } from "@/src/graph/store";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/tasks/:taskId/graph/events
 *
 * Returns runtime event stream (node_status, gate_verification, budget_consumed).
 * Spec reference: §11.3 History & Analytics
 *
 * Query parameters:
 *   - eventType: filter by event type (e.g. "node_status", "gate_verification", "budget_consumed")
 *   - since: ISO 8601 timestamp to filter events after
 *   - limit: max events to return (default 1000)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: rawTaskId } = await params;
  const taskId = normalizeTaskId(rawTaskId);
  if (!taskId) {
    return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  }

  const authz = await authorizeGraphMutation({
    request,
    taskId,
    action: "create",
  });
  if (!authz.ok) {
    return authz.response;
  }

  const graph = await getGraph(taskId);
  if (!graph) {
    return NextResponse.json({ error: "Graph not found" }, { status: 404 });
  }

  const searchParams = request.nextUrl.searchParams;
  const eventType = searchParams.get("eventType") ?? undefined;
  const since = searchParams.get("since") ?? undefined;
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(1, parseInt(limitParam, 10) || 1000), 10000) : 1000;

  const events = await getGraphEvents(graph.id, {
    eventType,
    since,
    limit,
  });

  return NextResponse.json({
    graphId: graph.id,
    taskId,
    currentGraphVersion: graph.graphVersion,
    events,
  });
}
