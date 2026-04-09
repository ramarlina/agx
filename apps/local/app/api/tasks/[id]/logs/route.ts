import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-instance";
import { createAdminDbClient } from "@/lib/db-adapter";
import { LOCAL_USER } from "@/lib/auth-mode";
import { getGraph } from "@/src/graph/store";

const LEGACY_NODE_LOG_FALLBACK_TAIL = 2000;
const LEGACY_NODE_LOG_WINDOW_BUFFER_MS = 2 * 60 * 1000;

function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) {
    const epochMs = value.getTime();
    return Number.isNaN(epochMs) ? null : epochMs;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const epochMs = Date.parse(value);
  return Number.isNaN(epochMs) ? null : epochMs;
}

function isWithinWindow(epochMs: number, startMs: number, endMs: number): boolean {
  return epochMs >= startMs - LEGACY_NODE_LOG_WINDOW_BUFFER_MS
    && epochMs <= endMs + LEGACY_NODE_LOG_WINDOW_BUFFER_MS;
}

// GET /api/tasks/[id]/logs - Get logs for a task
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = LOCAL_USER.id;

    const { id: rawId } = await params;
    // Resolve slug to UUID if needed
    let resolvedId = rawId;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(rawId)) {
      const adminDb = createAdminDbClient();
      const { data } = await adminDb
        .from("tasks")
        .select("id")
        .eq("slug", rawId)
        .limit(1)
        .maybeSingle();
      if (data?.id) resolvedId = data.id;
    }
    const task = await db.getTask(resolvedId, userId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const id = task.id;
    const { searchParams } = new URL(request.url);
    const tail = searchParams.get("tail");
    const limit = searchParams.get("limit");
    const after = searchParams.get("after");
    const nodeId = searchParams.get("nodeId");

    // Defaults chosen to avoid returning unbounded logs (can freeze the UI).
    let logs = await db.getTaskLogs(id, {
      tail: tail === null ? 500 : Number(tail),
      limit: limit === null ? undefined : Number(limit),
      after: after === null ? undefined : after,
      nodeId: nodeId === null ? undefined : nodeId,
    });

    // Backward-compatible fallback:
    // Older daemon builds wrote logs without node_id. If node-scoped query
    // returns empty, approximate by the node execution time window.
    if (nodeId && !after && logs.length === 0) {
      try {
        const graph = await getGraph(id);
        const selectedNode = graph?.nodes?.[nodeId];
        const nodeStartMs = toEpochMs(selectedNode?.startedAt);
        if (nodeStartMs !== null) {
          const nodeEndMs = toEpochMs(selectedNode?.completedAt)
            ?? Date.now();
          const requestedTail = Number(tail ?? limit ?? 500);
          const fallbackTail = Math.max(
            Number.isFinite(requestedTail) && requestedTail > 0 ? requestedTail : 500,
            LEGACY_NODE_LOG_FALLBACK_TAIL,
          );
          const fallbackLogs = await db.getTaskLogs(id, { tail: fallbackTail });
          logs = fallbackLogs.filter((entry) => {
            const createdAtMs = toEpochMs(entry.created_at);
            return createdAtMs !== null && isWithinWindow(createdAtMs, nodeStartMs, nodeEndMs);
          });
        }
      } catch {
        // Ignore fallback lookup issues and keep the original empty result.
      }
    }

    return NextResponse.json({ logs });
  } catch (error) {
    console.error("Error fetching logs:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}

// POST /api/tasks/[id]/logs - Add a log entry
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = LOCAL_USER.id;

    const { id } = await params;
    // `request.json()` throws on empty bodies ("Unexpected end of JSON input").
    // Return a 400 instead of turning this into a 500.
    const rawBody = await request.text();
    if (!rawBody || rawBody.trim() === "") {
      return NextResponse.json({ error: "JSON body is required" }, { status: 400 });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = body as Record<string, unknown>;
    const content = parsed?.content;
    const log_type = parsed?.log_type;
    const node_id = parsed?.node_id;

    if (typeof content !== "string" || content.trim() === "") {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const task = await db.getTask(id, userId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const normalizedLogType =
      typeof log_type !== "string" || log_type.trim() === ""
        ? "output"
        : log_type;
    const normalizedNodeId =
      typeof node_id === "string" && node_id.trim() !== "" ? node_id.trim() : undefined;
    const log = await db.addTaskLog(id, content, normalizedLogType, normalizedNodeId);
    return NextResponse.json({ log }, { status: 201 });
  } catch (error) {
    console.error("Error adding log:", error);
    return NextResponse.json({ error: "Failed to add log" }, { status: 500 });
  }
}
