import type { TaskStage, TaskStatus } from "../db";

export type TicketType = "task" | "spike";
export type StageDecision = "done" | "blocked" | "not_done" | "failed";

export interface StageDecisionPayload {
  decision: StageDecision;
  explanation: string;
  finalResult: string;
}

export interface StageTransitionInput {
  currentStage: TaskStage;
  decision: StageDecision;
  ticketType: TicketType;
  retryCount: number;
  maxRetries?: number;
}

export interface StageTransition {
  nextStage: TaskStage;
  nextStatus: TaskStatus;
  retryCount: number;
  error: string | null;
  appendLog: { content: string; logType: "checkpoint" | "system" | "error" } | null;
}

const DEFAULT_STAGE_SEQUENCE: TaskStage[] = [
  "INTAKE",
  "PROGRESS",
  "DONE",
];

const STANDARD_STAGE_SEQUENCES: TaskStage[][] = [DEFAULT_STAGE_SEQUENCE];

export function normalizeTicketType(value: unknown): TicketType {
  if (typeof value !== "string") return "task";
  const normalized = value.trim().toLowerCase();
  if (normalized === "spike" || normalized === "spikes") return "spike";
  return "task";
}

export function getTicketType(frontmatter: Record<string, unknown>, markdownBody: string): TicketType {
  const typeKeys = ["ticket_type", "type", "issue_type", "kind"];
  for (const key of typeKeys) {
    if (normalizeTicketType(frontmatter[key]) === "spike") return "spike";
  }

  const titleMatch = markdownBody.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim().toLowerCase() || "";
  if (title.startsWith("spike:") || title.startsWith("[spike]")) {
    return "spike";
  }

  return "task";
}

export function getNextStage(currentStage: TaskStage, ticketType: TicketType): TaskStage | null {
  if (ticketType === "spike") {
    if (currentStage === "INTAKE") return "PROGRESS";
    if (currentStage === "DONE") return null;
    return "DONE";
  }

  for (const sequence of STANDARD_STAGE_SEQUENCES) {
    const index = sequence.indexOf(currentStage);
    if (index === -1) continue;
    if (index >= sequence.length - 1) return null;
    return sequence[index + 1];
  }

  return null;
}

export function resolveStageTransition({
  currentStage,
  decision,
  ticketType,
  retryCount,
  maxRetries = 3,
}: StageTransitionInput): StageTransition {
  const nextStage = getNextStage(currentStage, ticketType);

  if (decision === "done") {
    if (nextStage) {
      return {
        nextStage,
        nextStatus: "queued",
        retryCount: 0,
        error: null,
        appendLog: { content: `Stage completed: ${currentStage}`, logType: "checkpoint" },
      };
    }

    return {
      nextStage: "DONE",
      nextStatus: "completed",
      retryCount: 0,
      error: null,
      appendLog: { content: `Task completed at stage ${currentStage}.`, logType: "checkpoint" },
    };
  }

  if (decision === "blocked") {
    return {
      nextStage: currentStage,
      nextStatus: "blocked",
      retryCount,
      error: null,
      appendLog: { content: "Blocked: additional input required.", logType: "system" },
    };
  }

  if (currentStage === "PROGRESS") {
    return {
      nextStage: "PROGRESS",
      nextStatus: "queued",
      retryCount: 0,
      error: null,
      appendLog: {
        content: "Stage not done. Retrying in PROGRESS.",
        logType: "system",
      },
    };
  }

  const nextRetryCount = retryCount + 1;
  if (nextRetryCount <= maxRetries) {
    return {
      nextStage: currentStage,
      nextStatus: "queued",
      retryCount: nextRetryCount,
      error: null,
      appendLog: {
        content: `Retrying (${nextRetryCount}/${maxRetries}) for stage ${currentStage}.`,
        logType: "system",
      },
    };
  }

  return {
    nextStage: currentStage,
    nextStatus: "failed",
    retryCount: nextRetryCount,
    error: "Task failed.",
    appendLog: { content: "Task failed.", logType: "error" },
  };
}

// ============ WORKFLOW-DRIVEN TRANSITIONS ============

import {
  getWorkflowNodeByName,
  getWorkflowTransitionsFromNode,
  getWorkflowNodes,
  type WorkflowNode,
  type WorkflowTransitionCondition,
} from "../db";

export interface WorkflowTransitionInput {
  workflowId: string;
  currentNodeName: string;
  decision: StageDecision;
  retryCount: number;
  maxRetries?: number;
}

export interface WorkflowTransitionResult {
  nextNodeName: string;
  nextStatus: TaskStatus;
  retryCount: number;
  error: string | null;
  appendLog: { content: string; logType: "checkpoint" | "system" | "error" } | null;
  nodeConfig?: WorkflowNode | null;
}

/**
 * Map agent decision to workflow transition condition
 */
function decisionToCondition(decision: StageDecision): WorkflowTransitionCondition {
  switch (decision) {
    case "done":
      return "done";
    case "blocked":
      return "blocked";
    case "failed":
    case "not_done":
      return "failed";
    default:
      return "done";
  }
}

/**
 * Resolve workflow-driven transition based on workflow graph
 * This is used when a task has a workflow_id set
 */
export async function resolveWorkflowTransition({
  workflowId,
  currentNodeName,
  decision,
  retryCount,
  maxRetries = 3,
}: WorkflowTransitionInput): Promise<WorkflowTransitionResult> {
  // Keep terminal semantics stable even if a workflow is misconfigured
  // with transitions out of a node named "done" (e.g. "done" -> "intake").
  if (String(currentNodeName).trim().toLowerCase() === "done") {
    return {
      nextNodeName: "done",
      nextStatus: "completed",
      retryCount: 0,
      error: null,
      appendLog: { content: "Task completed at done", logType: "checkpoint" },
      nodeConfig: null,
    };
  }

  // Get current node
  const currentNode = await getWorkflowNodeByName(workflowId, currentNodeName);
  if (!currentNode) {
    // Fallback: node not found in workflow, stay at current position
    return {
      nextNodeName: currentNodeName,
      nextStatus: "blocked",
      retryCount,
      error: `Node '${currentNodeName}' not found in workflow`,
      appendLog: { content: `Workflow error: node '${currentNodeName}' not found`, logType: "error" },
      nodeConfig: null,
    };
  }

  // Handle terminal nodes
  if (currentNode.node_type === "terminal") {
    return {
      nextNodeName: currentNodeName,
      nextStatus: "completed",
      retryCount: 0,
      error: null,
      appendLog: { content: `Task completed at ${currentNode.label || currentNodeName}`, logType: "checkpoint" },
      nodeConfig: currentNode,
    };
  }

  // Handle blocked decision
  if (decision === "blocked") {
    return {
      nextNodeName: currentNodeName,
      nextStatus: "blocked",
      retryCount,
      error: null,
      appendLog: { content: "Blocked: additional input required.", logType: "system" },
      nodeConfig: currentNode,
    };
  }

  // Get transitions from current node
  const transitions = await getWorkflowTransitionsFromNode(workflowId, currentNode.id);
  const condition = decisionToCondition(decision);

  // Find matching transition
  const matchingTransition = transitions.find(t => t.condition === condition);

  if (matchingTransition) {
    // Get the target node
    const allNodes = await getWorkflowNodes(workflowId);
    const targetNode = allNodes.find(n => n.id === matchingTransition.to_node_id);

    if (targetNode) {
      const isCompleting = targetNode.node_type === "terminal";
      return {
        nextNodeName: targetNode.name,
        nextStatus: isCompleting ? "completed" : "queued",
        retryCount: 0,
        error: null,
        appendLog: {
          content: decision === "done"
            ? `Stage completed: ${currentNode.label || currentNodeName}`
            : `Transition to ${targetNode.label || targetNode.name}`,
          logType: decision === "done" ? "checkpoint" : "system",
        },
        nodeConfig: targetNode,
      };
    }
  }

  // No matching transition found - handle retry/fail logic
  if (decision === "done") {
    // No 'done' transition means we're at a terminal stage
    return {
      nextNodeName: currentNodeName,
      nextStatus: "completed",
      retryCount: 0,
      error: null,
      appendLog: { content: `Task completed at ${currentNode.label || currentNodeName}`, logType: "checkpoint" },
      nodeConfig: currentNode,
    };
  }

  // Handle failed/not_done: retry logic
  const nextRetryCount = retryCount + 1;
  if (nextRetryCount <= maxRetries) {
    return {
      nextNodeName: currentNodeName,
      nextStatus: "queued",
      retryCount: nextRetryCount,
      error: null,
      appendLog: {
        content: `Retrying (${nextRetryCount}/${maxRetries}) for ${currentNode.label || currentNodeName}`,
        logType: "system",
      },
      nodeConfig: currentNode,
    };
  }

  // Max retries exceeded
  return {
    nextNodeName: currentNodeName,
    nextStatus: "failed",
    retryCount: nextRetryCount,
    error: "Task failed after max retries.",
    appendLog: { content: "Task failed after max retries.", logType: "error" },
    nodeConfig: currentNode,
  };
}
