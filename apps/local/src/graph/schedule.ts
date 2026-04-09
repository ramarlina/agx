import type { ExecutionGraph, GraphSchedule } from './types';
import { computeNextTickFromCron } from './scheduler';

/**
 * Determines whether a scheduled tick should fire.
 *
 * Returns the mutated graph with reset nodes if a tick fires,
 * or null if no tick is due.
 *
 * Invariants:
 * - Skip if schedule is not active
 * - Skip if a tick is already in progress (overlap prevention)
 * - Skip if maxRuns reached
 * - Reset only the specified resetNodeIds to pending
 * - Mark tickInProgress = true so concurrent ticks are skipped
 */
export interface ScheduleTickResult {
  graph: ExecutionGraph;
  tickFired: boolean;
  /** Node IDs that were reset to pending */
  resetNodeIds: string[];
  /** Reason tick was skipped (if tickFired is false) */
  skipReason?: 'not_active' | 'tick_in_progress' | 'max_runs_reached' | 'not_due' | 'no_schedule';
}

export function scheduleTickIfDue(
  graph: ExecutionGraph,
  nowMs: number = Date.now(),
): ScheduleTickResult {
  const noTick = (reason: ScheduleTickResult['skipReason']): ScheduleTickResult => ({
    graph,
    tickFired: false,
    resetNodeIds: [],
    skipReason: reason,
  });

  if (!graph.schedule) {
    return noTick('no_schedule');
  }

  const schedule = graph.schedule;

  if (schedule.state !== 'active') {
    return noTick('not_active');
  }

  if (schedule.tickInProgress) {
    return noTick('tick_in_progress');
  }

  if (schedule.maxRuns != null && schedule.runCount >= schedule.maxRuns) {
    return noTick('max_runs_reached');
  }

  // Check timing: cron-based (nextTickAt) or interval-based
  if (schedule.cronExpr && typeof schedule.nextTickAt === 'number') {
    if (nowMs < schedule.nextTickAt) {
      return noTick('not_due');
    }
  } else {
    const lastTick = schedule.lastTickAt ?? 0;
    if (nowMs - lastTick < schedule.intervalMs) {
      return noTick('not_due');
    }
  }

  // Fire the tick: reset target nodes and mark tick in progress
  const nextGraph: ExecutionGraph = JSON.parse(JSON.stringify(graph));
  const resetIds: string[] = [];

  for (const nodeId of schedule.resetNodeIds) {
    const node = nextGraph.nodes[nodeId];
    if (!node) continue;

    // Only reset terminal nodes back to pending
    if (
      node.status === 'done' ||
      node.status === 'passed' ||
      node.status === 'failed' ||
      node.status === 'skipped'
    ) {
      nextGraph.nodes[nodeId] = {
        ...node,
        status: 'pending',
        startedAt: undefined,
        completedAt: undefined,
        metrics: undefined,
        // Clear output for function nodes so downstream conditionals see fresh data
        ...(node.type === 'function' ? { output: undefined } : {}),
        // Clear evaluatedTo for conditional nodes
        ...(node.type === 'conditional' ? { evaluatedTo: undefined } : {}),
      } as typeof node;
      resetIds.push(nodeId);
    }
  }

  nextGraph.schedule = {
    ...schedule,
    tickInProgress: true,
    lastTickAt: nowMs,
    runCount: schedule.runCount + 1,
  };

  return {
    graph: nextGraph,
    tickFired: true,
    resetNodeIds: resetIds,
  };
}

/**
 * Mark a scheduled tick as complete. Call after the tick's subgraph
 * has finished executing (all reset nodes reached terminal state or
 * were skipped by conditional).
 */
export function completeScheduleTick(graph: ExecutionGraph): ExecutionGraph {
  if (!graph.schedule || !graph.schedule.tickInProgress) {
    return graph;
  }

  const schedule = graph.schedule;
  let nextTickAt = schedule.nextTickAt;
  if (schedule.cronExpr) {
    nextTickAt = computeNextTickFromCron(schedule.cronExpr);
  }

  return {
    ...graph,
    schedule: {
      ...schedule,
      tickInProgress: false,
      nextTickAt,
    },
  };
}

/**
 * Check if all nodes in resetNodeIds have reached a terminal state,
 * meaning the tick's subgraph is done executing.
 */
export function isScheduleTickComplete(graph: ExecutionGraph): boolean {
  if (!graph.schedule) return true;

  const terminalStatuses = new Set(['done', 'passed', 'failed', 'skipped']);

  for (const nodeId of graph.schedule.resetNodeIds) {
    const node = graph.nodes[nodeId];
    if (!node) continue;
    if (!terminalStatuses.has(node.status)) {
      return false;
    }
  }

  // Also check nodes downstream of resetNodeIds that may have been triggered
  // For now, just check the reset nodes themselves — the conditional and work
  // nodes downstream will be covered by the graph's normal completion check
  return true;
}

/**
 * Create a schedule configuration for the thread monitor subgraph.
 */
export function createThreadMonitorSchedule(
  resetNodeIds: string[],
  intervalMs: number = 60000,
  maxRuns?: number,
): GraphSchedule {
  return {
    intervalMs,
    state: 'active',
    resetNodeIds,
    maxRuns,
    runCount: 0,
    tickInProgress: false,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Activate an existing schedule (idempotent — no-op if already active).
 */
export function activateSchedule(graph: ExecutionGraph): ExecutionGraph {
  if (!graph.schedule) return graph;
  if (graph.schedule.state === 'active') return graph; // idempotent
  return {
    ...graph,
    schedule: {
      ...graph.schedule,
      state: 'active',
    },
  };
}

/**
 * Stop a schedule immediately. Clears tickInProgress.
 */
export function stopSchedule(graph: ExecutionGraph): ExecutionGraph {
  if (!graph.schedule) return graph;
  return {
    ...graph,
    schedule: {
      ...graph.schedule,
      state: 'stopped',
      tickInProgress: false,
    },
  };
}
