import { NextRequest } from "next/server";

import { createAdminDbClient } from "@/lib/db-adapter";
import { db } from "@/lib/db-instance";
import { parseFrontmatter } from "@/lib/db";
import {
  extractAndStoreMemories,
  extractAndStoreProjectKnowledge,
  resolveMemoryAgentId,
} from "@/lib/memory-extractor";
import { buildMarkdownWithFrontmatter } from "@/lib/orchestration/frontmatter";
import {
  ErrorResponseSchema,
  VerifyGateRequestSchema,
} from "@/src/graph/api-schemas";
import {
  jsonWithSchema,
  normalizeNodeId,
  normalizeTaskId,
  parseJsonBody,
} from "@/src/graph/api-route-utils";
import { applyNodeStatusMutation } from "@/src/graph/node-ops";
import { getGraph } from "@/src/graph/store";
import type { ExecutionGraph, NodeStatus } from "@/src/graph/types";

interface RouteParams {
  params: Promise<{ id: string; nodeId: string }>;
}

const INCOMPLETE_STATUSES: ReadonlySet<NodeStatus> = new Set([
  "pending",
  "running",
  "awaiting_human",
  "blocked",
]);

function hasFailedNodes(graph: ExecutionGraph): boolean {
  return Object.values(graph.nodes || {}).some((node) => node?.status === "failed");
}

function allCompletionSinksPassed(graph: ExecutionGraph): boolean {
  const sinkIds = Array.isArray(graph?.doneCriteria?.completionSinkNodeIds)
    ? graph.doneCriteria.completionSinkNodeIds
    : [];
  if (sinkIds.length === 0) return !hasFailedNodes(graph);
  return sinkIds.every((nodeId) => {
    const status = graph.nodes?.[nodeId]?.status;
    return status === "done" || status === "passed";
  });
}

function hasIncompleteNodes(graph: ExecutionGraph): boolean {
  return Object.values(graph.nodes || {}).some((node) => Boolean(node) && INCOMPLETE_STATUSES.has(node.status));
}

function hasAwaitingHumanNodes(graph: ExecutionGraph): boolean {
  return Object.values(graph.nodes || {}).some((node) => node?.status === "awaiting_human");
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code || "") : "";
  const message = "message" in error ? String(error.message || "").toLowerCase() : "";
  if (code !== "42703" && code !== "PGRST204") return false;
  return message.includes(columnName.toLowerCase());
}

async function updateTaskRowCompat(
  db: ReturnType<typeof createAdminDbClient>,
  taskId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  let updatePayload = { ...payload };

  while (true) {
    const { error } = await db
      .from("tasks")
      .update(updatePayload)
      .eq("id", taskId);

    if (!error) {
      return;
    }

    // Older schemas may not have blocked_reason yet.
    if ("blocked_reason" in updatePayload && isMissingColumnError(error, "blocked_reason")) {
      const { blocked_reason, ...rest } = updatePayload as Record<string, unknown>;
      updatePayload = rest;
      continue;
    }

    throw error;
  }
}

async function updateGraphExecutionStateCompat(
  db: ReturnType<typeof createAdminDbClient>,
  graphId: string,
  executionState: "running" | "done",
  nowIso: string,
): Promise<void> {
  const { error } = await db
    .from("execution_graphs")
    .update({
      execution_state: executionState,
      updated_at: nowIso,
    })
    .eq("id", graphId);

  // Older schemas may not have execution_state.
  if (error && !isMissingColumnError(error, "execution_state")) {
    throw error;
  }
}

async function reconcileTaskAfterApproval(taskId: string): Promise<void> {
  const graph = await getGraph(taskId);
  if (!graph) return;

  const task = await db.getTask(taskId);
  if (!task) return;

  const parsed = parseFrontmatter(String(task.content || ""));
  const frontmatter = { ...parsed.frontmatter };
  const memoryAgentId = resolveMemoryAgentId({
    defaultUserId: task.user_id || "system",
    frontmatter: parsed.frontmatter as Record<string, unknown>,
  });
  const body = parsed.body;
  const nowIso = new Date().toISOString();
  const adminDb = createAdminDbClient();
  const graphIncomplete = hasIncompleteNodes(graph);
  const graphComplete = !graphIncomplete;
  const graphDone = graphComplete && allCompletionSinksPassed(graph);

  if (graphDone) {
    frontmatter.stage = "DONE";
    frontmatter.status = "completed";
    if ("error" in frontmatter) delete (frontmatter as { error?: unknown }).error;
    const content = buildMarkdownWithFrontmatter(frontmatter, body);

    await updateTaskRowCompat(adminDb, taskId, {
      content,
      stage: "DONE",
      status: "completed",
      blocked_reason: null,
      completed_at: nowIso,
      updated_at: nowIso,
    });
    await updateGraphExecutionStateCompat(adminDb, graph.id, "done", nowIso);

    // Fire-and-forget memory extraction
    const nodeOutputs: Record<string, unknown> = {};
    for (const [nid, node] of Object.entries(graph.nodes)) {
      if (node?.type === "work" && node.output) nodeOutputs[nid] = node.output;
    }
    extractAndStoreMemories(taskId, memoryAgentId, {
      goal: String(task.content || task.title || ""),
      status: "completed",
      nodeOutputs,
    }).catch((err) => console.warn("[verify] Memory extraction failed:", err));
    extractAndStoreProjectKnowledge(taskId, task.project_id || task.project, {
      goal: String(task.content || task.title || ""),
      status: "completed",
      nodeOutputs,
    }).catch((err) => console.warn("[verify] Project knowledge extraction failed:", err));

    return;
  }

  if (graphComplete) {
    frontmatter.status = "failed";
    const content = buildMarkdownWithFrontmatter(frontmatter, body);

    await updateTaskRowCompat(adminDb, taskId, {
      content,
      status: "failed",
      blocked_reason: null,
      completed_at: nowIso,
      updated_at: nowIso,
    });
    await updateGraphExecutionStateCompat(adminDb, graph.id, "done", nowIso);

    // Fire-and-forget memory extraction (failed tasks have gotchas worth remembering)
    const nodeOutputs: Record<string, unknown> = {};
    for (const [nid, node] of Object.entries(graph.nodes)) {
      if (node?.type === "work" && node.output) nodeOutputs[nid] = node.output;
    }
    extractAndStoreMemories(taskId, memoryAgentId, {
      goal: String(task.content || task.title || ""),
      status: "failed",
      nodeOutputs,
    }).catch((err) => console.warn("[verify] Memory extraction failed:", err));
    extractAndStoreProjectKnowledge(taskId, task.project_id || task.project, {
      goal: String(task.content || task.title || ""),
      status: "failed",
      nodeOutputs,
    }).catch((err) => console.warn("[verify] Project knowledge extraction failed:", err));

    return;
  }

  // Approval cleared at least one human blocker; if none remain, wake execution.
  if (graphIncomplete && !hasAwaitingHumanNodes(graph)) {
    frontmatter.status = "queued";
    frontmatter.stage = "PROGRESS";
    if ("error" in frontmatter) delete (frontmatter as { error?: unknown }).error;
    const content = buildMarkdownWithFrontmatter(frontmatter, body);

    await updateTaskRowCompat(adminDb, taskId, {
      content,
      status: "queued",
      stage: "PROGRESS",
      blocked_reason: null,
      completed_at: null,
      updated_at: nowIso,
    });
    await updateGraphExecutionStateCompat(adminDb, graph.id, "running", nowIso);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: taskId, nodeId } = await params;
  const normalizedTaskId = normalizeTaskId(taskId);
  const normalizedNodeId = normalizeNodeId(nodeId);
  if (!normalizedTaskId || !normalizedNodeId) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Invalid taskId or nodeId" }, { status: 400 });
  }

  const parsedBody = await parseJsonBody(request, VerifyGateRequestSchema);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  const body = parsedBody.data;

  const mutationResponse = await applyNodeStatusMutation({
    request,
    taskId: normalizedTaskId,
    nodeId: normalizedNodeId,
    action: "node_verify",
    requestedProjectId: body.projectId ?? body.project_id,
    ifMatchGraphVersion: body.ifMatchGraphVersion,
    targetStatus: body.approved ? "passed" : "failed",
    reason: body.feedback?.trim() || "gate verification submitted",
    gateChecks: body.checks ?? [],
    consumeVerifyBudget: true,
    patch: {
      completedAt: body.completedAt ?? new Date().toISOString(),
    },
  });

  if (!mutationResponse.ok || !body.approved) {
    return mutationResponse;
  }

  try {
    await reconcileTaskAfterApproval(normalizedTaskId);
  } catch (error) {
    // Keep gate mutation response successful even if wake/complete sync fails.
    console.error("Failed to reconcile task after gate approval:", error);
  }

  return mutationResponse;
}
