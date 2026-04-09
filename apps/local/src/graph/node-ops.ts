import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildBudgetConsumedEvent,
  buildGateVerificationEvent,
  buildNodeStatusEvent,
} from "@/src/graph/audit";
import {
  ErrorResponseSchema,
  NodeMutationResponseSchema,
} from "@/src/graph/api-schemas";
import {
  graphConflictResponse,
  jsonWithSchema,
} from "@/src/graph/api-route-utils";
import { authorizeGraphMutation, type GraphMutationAction } from "@/src/graph/middleware/authz";
import { recordGateVerificationResult } from "@/src/graph/observability";
import {
  appendEvent,
  getGraph,
  GraphNodeNotFoundError,
  GraphVersionConflictError,
  type NodeRuntimeUpdate,
  updateNodeRuntime,
} from "@/src/graph/store";
import { assertValidNodeStatusTransition } from "@/src/graph/state-machine";
import type { CheckResult, GraphNode, NodeStatus } from "@/src/graph/types";

export interface NodeStatusMutationInput {
  request: NextRequest;
  taskId: string;
  nodeId: string;
  action: Exclude<GraphMutationAction, "create" | "update" | "replan" | "rollback">;
  requestedProjectId?: string | null;
  ifMatchGraphVersion?: number;
  targetStatus: NodeStatus;
  reason?: string;
  patch?: Omit<NodeRuntimeUpdate, "status">;
  gateChecks?: CheckResult[];
  consumeVerifyBudget?: boolean;
  // Reset work-node attempt counters when manually re-running a node.
  resetWorkAttempts?: boolean;
  // Optional: restrict which statuses the node can transition from
  allowedFromStatuses?: NodeStatus[];
}

function isAutoPassProgressGate(node: GraphNode): boolean {
  if (node.type !== "gate") {
    return false;
  }
  const checks = node.verificationStrategy.checks ?? [];
  return node.gateType === "progress" && checks.length === 0 && node.verificationStrategy.type === "auto";
}

const GraphNodeMissingResponseSchema = z.object({
  error: z.string().min(1),
  nodeIds: z.array(z.string()),
});

async function appendRejectedTransitionEvent(input: {
  graphId: string;
  actor: { actorId: string; actorType: "user" | "service" };
  projectId: string | null;
  nodeId: string;
  fromStatus: NodeStatus;
  toStatus: NodeStatus;
  reason: string;
}): Promise<void> {
  try {
    await appendEvent(
      input.graphId,
      buildNodeStatusEvent({
        actor: input.actor,
        nodeId: input.nodeId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        reason: input.reason,
        projectId: input.projectId,
      }),
    );
  } catch (error) {
    console.error("Failed to append rejected node transition event", error);
  }
}

export async function applyNodeStatusMutation(input: NodeStatusMutationInput): Promise<NextResponse> {
  const authz = await authorizeGraphMutation({
    request: input.request,
    taskId: input.taskId,
    action: input.action,
    requestedProjectId: input.requestedProjectId,
  });
  if (!authz.ok) {
    return authz.response;
  }

  const graph = await getGraph(input.taskId);
  if (!graph) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Graph not found" }, { status: 404 });
  }

  const node = graph.nodes[input.nodeId];
  if (!node) {
    return jsonWithSchema(ErrorResponseSchema, { error: "Node not found" }, { status: 404 });
  }

  // Check if transition is from an allowed status (if restricted)
  if (input.allowedFromStatuses && !input.allowedFromStatuses.includes(node.status)) {
    await appendRejectedTransitionEvent({
      graphId: graph.id,
      actor: authz.actor,
      projectId: authz.projectId,
      nodeId: input.nodeId,
      fromStatus: node.status,
      toStatus: input.targetStatus,
      reason: `Rejected: node must be in one of [${input.allowedFromStatuses.join(", ")}] to ${input.action}`,
    });
    return jsonWithSchema(
      ErrorResponseSchema,
      {
        error: `Cannot ${input.action} node ${input.nodeId}: current status is ${node.status}`,
      },
      { status: 400 },
    );
  }

  try {
    assertValidNodeStatusTransition(node.type, node.status, input.targetStatus);
  } catch {
    await appendRejectedTransitionEvent({
      graphId: graph.id,
      actor: authz.actor,
      projectId: authz.projectId,
      nodeId: input.nodeId,
      fromStatus: node.status,
      toStatus: input.targetStatus,
      reason: "Rejected invalid transition",
    });
    return jsonWithSchema(
      ErrorResponseSchema,
      {
        error: `Invalid node transition for ${input.nodeId}: ${node.status} -> ${input.targetStatus}`,
      },
      { status: 400 },
    );
  }

  if (node.type === "gate" && node.status === "pending" && input.targetStatus === "passed") {
    if (!isAutoPassProgressGate(node)) {
      await appendRejectedTransitionEvent({
        graphId: graph.id,
        actor: authz.actor,
        projectId: authz.projectId,
        nodeId: input.nodeId,
        fromStatus: node.status,
        toStatus: input.targetStatus,
        reason: "Rejected required gate bypass",
      });
      return jsonWithSchema(
        ErrorResponseSchema,
        {
          error: `Required gate transition blocked for node ${input.nodeId}`,
        },
        { status: 400 },
      );
    }
  }

  try {
    const runtimePatch: NodeRuntimeUpdate = {
      ...(input.patch ?? {}),
      status: input.targetStatus,
    };
    if (input.resetWorkAttempts && node.type === "work") {
      runtimePatch.configPatch = {
        ...(runtimePatch.configPatch ?? {}),
        attempts: 0,
      };
    }

    const updatePayload: Record<string, NodeRuntimeUpdate> = {
      [input.nodeId]: {
        ...runtimePatch,
      },
    };

    const updated = await updateNodeRuntime(
      graph.id,
      updatePayload,
      input.ifMatchGraphVersion ?? graph.graphVersion,
    );

    const timestamp = new Date().toISOString();
    await appendEvent(
      graph.id,
      buildNodeStatusEvent({
        actor: authz.actor,
        nodeId: input.nodeId,
        fromStatus: node.status,
        toStatus: input.targetStatus,
        reason: input.reason,
        timestamp,
        projectId: authz.projectId,
      }),
    );

    const gateVerificationRequested =
      node.type === "gate" || input.action === "node_verify";
    if (
      gateVerificationRequested &&
      (input.targetStatus === "passed" || input.targetStatus === "failed")
    ) {
      const passed = input.targetStatus === "passed";
      recordGateVerificationResult(passed);
      await appendEvent(
        graph.id,
        buildGateVerificationEvent({
          actor: authz.actor,
          nodeId: input.nodeId,
          timestamp,
          result: {
            passed,
            checks: input.gateChecks ?? [],
            verifiedAt: timestamp,
            verifiedBy: authz.actor.actorType === "user" ? "human" : "agent",
          },
          projectId: authz.projectId,
        }),
      );
    }

    if (input.consumeVerifyBudget || input.action === "node_verify") {
      const remaining = Math.max(0, graph.policy.verifyBudgetRemaining - 1);
      await appendEvent(
        graph.id,
        buildBudgetConsumedEvent({
          actor: authz.actor,
          budgetType: "verify",
          remaining,
          triggerNodeId: input.nodeId,
          timestamp,
          projectId: authz.projectId,
        }),
      );
    }

    return jsonWithSchema(NodeMutationResponseSchema, {
      graphId: graph.id,
      nodeId: input.nodeId,
      graphVersion: updated.graphVersion,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    if (error instanceof GraphVersionConflictError) {
      return graphConflictResponse(error);
    }
    if (error instanceof GraphNodeNotFoundError) {
      return jsonWithSchema(
        GraphNodeMissingResponseSchema,
        { error: error.message, nodeIds: error.nodeIds },
        { status: 404 },
      );
    }

    console.error("Error mutating node status:", error);
    return jsonWithSchema(
      ErrorResponseSchema,
      { error: "Failed to mutate node status" },
      { status: 500 },
    );
  }
}
