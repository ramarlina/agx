/**
 * Canonical derived functions from §9.2 of the execution graph spec.
 *
 * These are the authoritative implementations. The UI layer
 * (`components/graph/graph-derived.ts`) should re-export or delegate
 * to these rather than maintaining a parallel copy.
 */

import {
  INCOMPLETE_FOR_DONE_STATUSES,
  SUCCESS_NODE_STATUSES,
} from './constants';
import type {
  ExecutionGraph,
  GateNode,
  NodeStatus,
  RootNode,
} from './types';

const SUCCESS_SET = new Set<NodeStatus>(SUCCESS_NODE_STATUSES);
const INCOMPLETE_SET = new Set<NodeStatus>(INCOMPLETE_FOR_DONE_STATUSES);

// ---------------------------------------------------------------------------
// computeProgress  (§9.2)
// ---------------------------------------------------------------------------

/**
 * Percentage of non-skipped nodes that have reached a success state.
 */
export function computeProgress(graph: ExecutionGraph): number {
  const included = Object.values(graph.nodes).filter(
    (node) => node.status !== 'skipped',
  );
  if (included.length === 0) return 100;

  const successful = included.filter((node) =>
    SUCCESS_SET.has(node.status),
  ).length;

  return Math.round((successful / included.length) * 100);
}

// ---------------------------------------------------------------------------
// findCurrentBlocker  (§9.2)
// ---------------------------------------------------------------------------

/**
 * Identify the most relevant blocker preventing task completion.
 *
 * Priority order (spec §9.2):
 *   1. Failed required gate
 *   2. Required gate awaiting human
 *   3. Pending/running required gate
 *   4. Any blocked work node
 */
export function findCurrentBlocker(
  graph: ExecutionGraph,
): string | null {
  const entries = Object.entries(graph.nodes);

  const requiredGates = entries.filter(
    ([, n]) => n.type === 'gate' && (n as GateNode).required,
  );

  const failedGate = requiredGates.find(([, n]) => n.status === 'failed');
  if (failedGate) return failedGate[0];

  const humanGate = requiredGates.find(
    ([, n]) => n.status === 'awaiting_human',
  );
  if (humanGate) return humanGate[0];

  const pendingGate = requiredGates.find(([, n]) =>
    n.status === 'pending' || n.status === 'running',
  );
  if (pendingGate) return pendingGate[0];

  const blockedWork = entries.find(
    ([, n]) => n.type === 'work' && n.status === 'blocked',
  );
  return blockedWork?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// deriveTaskStatus  (§9.2)
// ---------------------------------------------------------------------------

export type DerivedTaskStatus = 'INTAKE' | 'PROGRESS' | 'DONE';

/**
 * Map graph state to the board column a task belongs in.
 *
 * - INTAKE: graph not yet classified (no nodes)
 * - PROGRESS: has incomplete nodes
 * - DONE: all nodes terminal
 */
export function deriveTaskStatus(
  graph: ExecutionGraph,
): DerivedTaskStatus {
  const nodeCount = Object.keys(graph.nodes).length;
  if (nodeCount === 0) return 'INTAKE';

  if (nodeCount === 1) {
    const onlyNode = Object.values(graph.nodes)[0];
    if (onlyNode.type === 'root' && !(onlyNode as RootNode).graphCreated) return 'INTAKE';
  }

  const hasIncomplete = Object.values(graph.nodes).some((node) =>
    INCOMPLETE_SET.has(node.status),
  );

  return hasIncomplete ? 'PROGRESS' : 'DONE';
}
