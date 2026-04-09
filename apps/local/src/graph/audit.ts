import type {
  BudgetConsumedEvent,
  GateVerificationEvent,
  GraphAuditAction,
  GraphEventAuditContext,
  GraphMode,
  NodeStatus,
  NodeStatusEvent,
  ReplanEvent,
  RollbackEvent,
  VerificationResult,
} from "./types";

export interface GraphAuditActor {
  actorId: string;
  actorType: GraphEventAuditContext["actorType"];
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildAudit(
  actor: GraphAuditActor,
  action: GraphAuditAction,
  projectId?: string | null,
): GraphEventAuditContext {
  return {
    actorId: actor.actorId,
    actorType: actor.actorType,
    action,
    ...(projectId ? { projectId } : {}),
  };
}

export function buildGraphCreatedEvent(input: {
  actor: GraphAuditActor;
  mode: GraphMode;
  nodeCount: number;
  edgeCount: number;
  timestamp?: string;
  projectId?: string | null;
}) {
  return {
    eventType: "graph_created" as const,
    timestamp: input.timestamp ?? nowIso(),
    mode: input.mode,
    nodeCount: input.nodeCount,
    edgeCount: input.edgeCount,
    audit: buildAudit(input.actor, "graph_create", input.projectId),
  };
}

export function buildNodeStatusEvent(input: {
  actor: GraphAuditActor;
  nodeId: string;
  fromStatus: NodeStatus;
  toStatus: NodeStatus;
  reason?: string;
  timestamp?: string;
  projectId?: string | null;
}): NodeStatusEvent {
  return {
    eventType: "node_status",
    nodeId: input.nodeId,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    timestamp: input.timestamp ?? nowIso(),
    ...(input.reason ? { reason: input.reason } : {}),
    audit: buildAudit(input.actor, "node_status_transition", input.projectId),
  };
}

export function buildGateVerificationEvent(input: {
  actor: GraphAuditActor;
  nodeId: string;
  result: VerificationResult;
  timestamp?: string;
  projectId?: string | null;
}): GateVerificationEvent {
  return {
    eventType: "gate_verification",
    nodeId: input.nodeId,
    timestamp: input.timestamp ?? nowIso(),
    result: input.result,
    audit: buildAudit(input.actor, "gate_verification", input.projectId),
  };
}

export function buildBudgetConsumedEvent(input: {
  actor: GraphAuditActor;
  budgetType: "replan" | "verify";
  remaining: number;
  triggerNodeId: string;
  timestamp?: string;
  projectId?: string | null;
}): BudgetConsumedEvent {
  return {
    eventType: "budget_consumed",
    budgetType: input.budgetType,
    remaining: input.remaining,
    triggerNodeId: input.triggerNodeId,
    timestamp: input.timestamp ?? nowIso(),
    audit: buildAudit(input.actor, "budget_consumption", input.projectId),
  };
}

export function buildReplanEvent(input: {
  actor: GraphAuditActor;
  fromVersion: number;
  toVersion: number;
  reason: string;
  triggeredAtNodeId: string;
  changes: ReplanEvent["changes"];
  triggeredBy?: ReplanEvent["triggeredBy"];
  timestamp?: string;
  projectId?: string | null;
}): ReplanEvent {
  return {
    eventType: "replan",
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    timestamp: input.timestamp ?? nowIso(),
    reason: input.reason,
    triggeredBy: input.triggeredBy ?? (input.actor.actorType === "user" ? "human" : "agent"),
    triggeredAtNodeId: input.triggeredAtNodeId,
    changes: input.changes,
    audit: buildAudit(input.actor, "graph_replan", input.projectId),
  };
}

export function buildRollbackEvent(input: {
  actor: GraphAuditActor;
  toCheckpoint: string;
  reason: string;
  triggeredBy?: RollbackEvent["triggeredBy"];
  timestamp?: string;
  projectId?: string | null;
}): RollbackEvent {
  return {
    eventType: "rollback",
    toCheckpoint: input.toCheckpoint,
    timestamp: input.timestamp ?? nowIso(),
    reason: input.reason,
    triggeredBy: input.triggeredBy ?? (input.actor.actorType === "user" ? "human" : "agent"),
    audit: buildAudit(input.actor, "graph_rollback", input.projectId),
  };
}
