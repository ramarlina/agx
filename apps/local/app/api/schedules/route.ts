import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createGraph,
  getGraph,
  getActiveScheduleForRootMessageId,
  getActiveScheduleRootMessageIds,
  deactivateSchedulesByRootMessageId,
} from "@/src/graph/store";
import { activateGraphSchedule } from "@/src/graph/scheduler";
import { createThreadMonitorSchedule } from "@/src/graph/schedule";
import type { ExecutionGraph, FunctionNode, ConditionalNode, WorkNode } from "@/src/graph/types";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

const ActivateSchema = z.object({
  action: z.literal("activate"),
  rootMessageId: z.string().trim().min(1),
  intervalMs: z.number().int().positive().optional(),
});

const StopSchema = z.object({
  action: z.literal("stop"),
  rootMessageId: z.string().trim().min(1),
});

const RequestSchema = z.discriminatedUnion("action", [ActivateSchema, StopSchema]);

/**
 * Build a minimal thread-monitor graph for the given rootMessageId.
 * Shape: [function: pull-status] → [conditional: idle-check]
 * The work node (verify-and-route) is downstream of the conditional in the real
 * graph but for v1 the cron just checks if agents are idle — the MC handles nudging.
 */
const STEER_PROMPT = `Review the conversation so far and determine whether the thread is actually ready to move into review.
If it is not ready, produce exactly one message that does both of these things together:
1. Briefly assess what has been accomplished and what remains.
2. Give the team the concrete next steps needed to move toward shipping.

Do not split status and instructions into separate responses. Keep it to one concise message.
Only mark the work complete when it is truly ready to stop ship mode and move into review.`;

function buildThreadMonitorGraph(
  rootMessageId: string,
  intervalMs: number,
): ExecutionGraph {
  const now = new Date().toISOString();
  const graphId = `sched-${rootMessageId}`;
  const taskId = rootMessageId;

  const pullStatusNode: FunctionNode = {
    type: "function",
    status: "pending",
    deps: [],
    kind: "internal",
    title: "Pull thread status",
    command: "thread-status",
    args: { rootMessageId },
  };

  const idleCheckNode: ConditionalNode = {
    type: "conditional",
    status: "pending",
    deps: ["pull-status"],
    condition: {
      expression: "input.activeProcessCount === 0",
      inputFrom: "pull-status",
    },
    thenBranch: ["steer"],
    elseBranch: [],
  };

  const steerNode: WorkNode = {
    type: "work",
    status: "pending",
    deps: ["idle-check"],
    title: "Steer toward completion",
    description: STEER_PROMPT,
    attempts: 0,
    maxAttempts: 2,
    retryPolicy: { backoffMs: 5_000, onExhaust: "fail" },
  };

  // act: reads steer node output and branches on isDone
  const actNode: FunctionNode = {
    type: "function",
    status: "pending",
    deps: ["steer"],
    kind: "internal",
    title: "Act on steer result",
    command: "ship-mode-act",
    args: { rootMessageId, steerNodeId: "steer" },
    timeoutMs: 300_000, // 5 min — agents need time
  };

  const resetNodeIds = ["pull-status", "idle-check", "steer", "act"];

  const graph: ExecutionGraph = {
    id: graphId,
    taskId,
    graphVersion: 1,
    mode: "SIMPLE",
    nodes: {
      "pull-status": pullStatusNode,
      "idle-check": idleCheckNode,
      "steer": steerNode,
      "act": actNode,
    },
    edges: [
      { from: "pull-status", to: "idle-check", type: "hard" },
      { from: "idle-check", to: "steer", type: "hard" },
      { from: "steer", to: "act", type: "hard", condition: "always" },
    ],
    policy: {
      replanBudgetRemaining: 0,
      replanBudgetInitial: 0,
      verifyBudgetRemaining: 0,
      verifyBudgetInitial: 0,
      maxConcurrentAutoChecks: 0,
      immutableRequiredGates: false,
      maxConcurrent: 1,
      priorityMode: "fifo",
      nodeTimeoutMs: 300_000, // 5 min — steer work node + act need time
      graphTimeoutMs: 0, // no graph-level timeout for recurring schedules
    },
    doneCriteria: {
      allRequiredGatesPassed: true,
      noRunnableOrPendingWork: true,
    },
    schedule: {
      ...createThreadMonitorSchedule(resetNodeIds, intervalMs),
      name: "Ship mode",
      description: "Automatically steers an idle thread toward completion.",
      maxConsecutiveFailures: DEFAULT_MAX_CONSECUTIVE_FAILURES,
      rootMessageId,
    },
    versionHistory: [],
    createdAt: now,
    updatedAt: now,
  };

  return graph;
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => ({}));
    const parsed = RequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const body = parsed.data;

    if (body.action === "stop") {
      const count = deactivateSchedulesByRootMessageId(body.rootMessageId);
      return NextResponse.json({ success: true, deactivated: count });
    }

    // action === "activate"
    const intervalMs = body.intervalMs ?? DEFAULT_INTERVAL_MS;

    // Check if there's already an active schedule for this rootMessageId
    const existing = getActiveScheduleForRootMessageId(body.rootMessageId);
    if (existing) {
      const graph = getGraph(existing.taskId);
      return NextResponse.json({
        success: true,
        alreadyActive: true,
        taskId: existing.taskId,
        graphId: existing.graphId,
        schedule: graph?.schedule ?? null,
      });
    }

    // Check if graph exists but schedule is stopped — reactivate it
    const existingGraph = getGraph(body.rootMessageId);
    if (existingGraph) {
      const reactivated = activateGraphSchedule(existingGraph, {
        intervalMs,
        resetNodeIds: existingGraph.schedule?.resetNodeIds ?? ["pull-status", "idle-check"],
        name: existingGraph.schedule?.name ?? "Ship mode",
        description: existingGraph.schedule?.description ?? "Automatically steers an idle thread toward completion.",
        maxConsecutiveFailures:
          existingGraph.schedule?.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES,
        rootMessageId: body.rootMessageId,
        nowIso: new Date().toISOString(),
      });
      // Persist
      const { updateGraphStructure } = await import("@/src/graph/store");
      updateGraphStructure(
        reactivated.id,
        {
          mode: reactivated.mode,
          nodes: reactivated.nodes,
          edges: reactivated.edges,
          policy: reactivated.policy,
          doneCriteria: reactivated.doneCriteria,
          schedule: reactivated.schedule,
        },
        existingGraph.graphVersion,
      );
      const fresh = getGraph(body.rootMessageId);
      return NextResponse.json({
        success: true,
        reactivated: true,
        taskId: body.rootMessageId,
        graphId: fresh?.id ?? reactivated.id,
        schedule: fresh?.schedule ?? reactivated.schedule,
      });
    }

    // Create new thread-monitor graph
    const graph = buildThreadMonitorGraph(body.rootMessageId, intervalMs);
    createGraph(graph, { skipTaskBinding: true });

    return NextResponse.json({
      success: true,
      created: true,
      taskId: graph.taskId,
      graphId: graph.id,
      schedule: graph.schedule,
    });
  } catch (error) {
    logger.error("Schedule API error", logger.formatError(error));
    return NextResponse.json(
      { error: "Failed to manage schedule", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * GET /api/schedules?rootMessageId=<id>
 * Returns the schedule status for a given rootMessageId.
 */
export async function GET(request: NextRequest) {
  const rootMessageId = request.nextUrl.searchParams.get("rootMessageId");
  if (!rootMessageId) {
    // Return all active schedule root message IDs
    const ids = getActiveScheduleRootMessageIds();
    return NextResponse.json({ activeRootMessageIds: ids });
  }

  const active = getActiveScheduleForRootMessageId(rootMessageId);
  if (!active) {
    return NextResponse.json({ active: false });
  }

  const graph = getGraph(active.taskId);
  return NextResponse.json({
    active: true,
    taskId: active.taskId,
    graphId: active.graphId,
    schedule: graph?.schedule ?? null,
  });
}
