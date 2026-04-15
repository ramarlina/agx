import { getSQLiteDb } from '@/lib/sqlite-query-adapter';
import {
  automationRecordToGraphSchedule,
  getAutomationRepository,
  isAutomationDualReadEnabled,
  isAutomationFrontmatterEnabled,
} from '@/src/automations';
import { scheduleTickIfDue, completeScheduleTick, isScheduleTickComplete } from './schedule';
import { schedulerTick } from './scheduler';
import { executeNode, type ExecutorContext } from './executor';
import { GraphStore } from './store';
import type { ExecutionGraph, GraphSchedule } from './types';

/**
 * Result of a schedule poll operation.
 */
export interface PendingWorkItem {
  /** Task/graph ID */
  taskId: string;
  /** Work node IDs ready to dispatch */
  nodeIds: string[];
  /** The graph snapshot after function/conditional execution */
  graph: ExecutionGraph;
}

export interface SchedulePollResult {
  /** Graph IDs that had ticks fire */
  tickedGraphIds: string[];
  /** Graph IDs that were skipped (not due, in progress, etc.) */
  skippedGraphIds: string[];
  /** Errors encountered */
  errors: Array<{ graphId: string; error: Error }>;
  /** Work nodes ready to dispatch (identified but not executed by pollSchedules) */
  pendingWork: PendingWorkItem[];
}

/**
 * Fetches all graphs with active schedules from the database.
 */
export function getGraphsWithActiveSchedules(): Array<{ taskId: string; graphId: string; schedule: GraphSchedule }> {
  const recordsByGraphId = new Map<string, { taskId: string; graphId: string; schedule: GraphSchedule }>();
  const db = getSQLiteDb();
  const rows = db.prepare(`
    SELECT task_id, id, schedule
    FROM execution_graphs
    WHERE schedule IS NOT NULL
      AND json_extract(schedule, '$.state') = 'active'
  `).all() as Array<{ task_id: string; id: string; schedule: string }>;
  const rowByGraphId = new Map(rows.map((row) => [row.id, row]));

  if (isAutomationFrontmatterEnabled()) {
    for (const record of getAutomationRepository().listVisibleAutomations({
      targetType: 'execution_graph',
      state: 'active',
    })) {
      if (record.definition.target.type !== 'execution_graph') {
        continue;
      }

      const graphId = record.definition.target.graphId ?? record.definition.id;
      const taskId = record.definition.target.taskId ?? rowByGraphId.get(graphId)?.task_id ?? graphId;
      recordsByGraphId.set(graphId, {
        taskId,
        graphId,
        schedule: automationRecordToGraphSchedule(record, rowByGraphId.get(graphId)
          ? JSON.parse(rowByGraphId.get(graphId)!.schedule) as GraphSchedule
          : undefined),
      });
    }

    if (!isAutomationDualReadEnabled()) {
      return [...recordsByGraphId.values()];
    }
  }

  for (const row of rows) {
    if (!recordsByGraphId.has(row.id)) {
      recordsByGraphId.set(row.id, {
        taskId: row.task_id,
        graphId: row.id,
        schedule: JSON.parse(row.schedule) as GraphSchedule,
      });
    }
  }

  return [...recordsByGraphId.values()];
}

/**
 * Polls all graphs with active schedules and executes due ticks.
 *
 * For each graph with an active schedule:
 * 1. Check if a tick is due
 * 2. If yes, reset the target nodes and mark tick in progress
 * 3. Run the scheduler to dispatch function nodes
 * 4. Execute function nodes and persist results
 * 5. Mark tick complete when all reset nodes reach terminal state
 */
export async function pollSchedules(
  context: ExecutorContext = {},
): Promise<SchedulePollResult> {
  const store = new GraphStore();
  const result: SchedulePollResult = {
    tickedGraphIds: [],
    skippedGraphIds: [],
    errors: [],
    pendingWork: [],
  };

  const activeSchedules = getGraphsWithActiveSchedules();
  console.log(`[schedules:poll] found ${activeSchedules.length} active schedule(s)`);

  for (const { taskId } of activeSchedules) {
    try {
      const graph = store.getGraph(taskId);
      if (!graph) {
        result.errors.push({ graphId: taskId, error: new Error('Graph not found') });
        continue;
      }

      // Check if tick is due
      const tickResult = scheduleTickIfDue(graph);
      if (!tickResult.tickFired) {
        console.log(`[schedules:poll] ${taskId} skipped (${tickResult.skipReason ?? 'unknown'})`);
        result.skippedGraphIds.push(taskId);
        continue;
      }

      console.log(`[schedules:poll] ${taskId} tick fired — resetting nodes`);

      // Tick fired - persist the updated graph with nodes reset
      store.updateGraphStructure(tickResult.graph.id, {
        nodes: tickResult.graph.nodes,
        schedule: tickResult.graph.schedule,
      });

      // Run the scheduler tick to get runnable nodes
      const schedulerResult = schedulerTick(tickResult.graph, context);
      console.log(`[schedules:poll] ${taskId} scheduler: fn=${schedulerResult.functionToRun.length} work=${schedulerResult.workToRun.length}`);

      // Execute function nodes
      let currentGraph = schedulerResult.graph;
      for (const nodeId of schedulerResult.functionToRun) {
        const node = currentGraph.nodes[nodeId];
        if (!node || node.type !== 'function') continue;

        try {
          console.log(`[schedules:poll] ${taskId} executing function node "${nodeId}"`);
          const execResult = await executeNode(currentGraph, nodeId, context);
          const resultNode = execResult.graph.nodes[nodeId];
          console.log(`[schedules:poll] ${taskId} function "${nodeId}" → ${resultNode?.status}`, resultNode && 'output' in resultNode ? JSON.stringify((resultNode as any).output)?.slice(0, 200) : '');
          currentGraph = execResult.graph;
        } catch (err) {
          console.error(`[schedules:poll] ${taskId} function "${nodeId}" error:`, err);
          result.errors.push({
            graphId: taskId,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }

      // Persist updated node states after function execution
      store.updateGraphStructure(currentGraph.id, {
        nodes: currentGraph.nodes,
      });

      // Second pass: re-run scheduler to find work nodes now unblocked by function/conditional results
      const postFunctionResult = schedulerTick(currentGraph, context);
      console.log(`[schedules:poll] ${taskId} post-fn scheduler: cond=${postFunctionResult.control.conditionalNodeIds.length} work=${postFunctionResult.workToRun.length}`);
      currentGraph = postFunctionResult.graph;

      // Auto-dispatch work nodes in scheduled runs
      for (const nodeId of postFunctionResult.workToRun) {
        const node = currentGraph.nodes[nodeId];
        if (!node || node.type !== 'work') continue;

        try {
          const execResult = await executeNode(currentGraph, nodeId, context);
          currentGraph = execResult.graph;
        } catch (err) {
          result.errors.push({
            graphId: taskId,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }

      if (postFunctionResult.workToRun.length > 0) {
        result.pendingWork.push({
          taskId,
          nodeIds: postFunctionResult.workToRun,
          graph: currentGraph,
        });

        // Third pass: persist work results, then run any function nodes
        // that became unblocked (e.g. act node after steer work node)
        store.updateGraphStructure(currentGraph.id, {
          nodes: currentGraph.nodes,
        });

        const postWorkResult = schedulerTick(currentGraph, context);
        console.log(`[schedules:poll] ${taskId} post-work scheduler: fn=${postWorkResult.functionToRun.length} cond=${postWorkResult.control.conditionalNodeIds.length}`);
        currentGraph = postWorkResult.graph;

        for (const nodeId of postWorkResult.functionToRun) {
          const node = currentGraph.nodes[nodeId];
          if (!node || node.type !== 'function') continue;

          try {
            console.log(`[schedules:poll] ${taskId} executing post-work function "${nodeId}"`);
            const execResult = await executeNode(currentGraph, nodeId, context);
            currentGraph = execResult.graph;
          } catch (err) {
            console.error(`[schedules:poll] ${taskId} post-work function "${nodeId}" error:`, err);
            result.errors.push({
              graphId: taskId,
              error: err instanceof Error ? err : new Error(String(err)),
            });
          }
        }
      }

      // Always persist after all passes
      store.updateGraphStructure(currentGraph.id, {
        nodes: currentGraph.nodes,
      });

      // Check if tick is complete
      const nodeStates = Object.entries(currentGraph.nodes).map(([id, n]) => `${id}:${n.status}`).join(', ');
      console.log(`[schedules:poll] ${taskId} node states: ${nodeStates}`);
      const tickComplete = isScheduleTickComplete(currentGraph);
      console.log(`[schedules:poll] ${taskId} tick complete? ${tickComplete}`);
      if (tickComplete) {
        const completed = completeScheduleTick(currentGraph);

        // Track failures: check if any reset node ended in 'failed' status
        const hasFailedNode = completed.schedule?.resetNodeIds.some(
          (nodeId) => completed.nodes[nodeId]?.status === 'failed',
        );
        if (completed.schedule) {
          const prevFails = completed.schedule.consecutiveFailures ?? 0;
          const newFails = hasFailedNode ? prevFails + 1 : 0;
          completed.schedule = {
            ...completed.schedule,
            consecutiveFailures: newFails,
          };

          // Auto-pause if max consecutive failures exceeded
          const maxFails = completed.schedule.maxConsecutiveFailures;
          if (maxFails != null && newFails >= maxFails) {
            completed.schedule = {
              ...completed.schedule,
              state: 'paused',
            };
          }
        }

        // Re-read DB schedule state to respect mid-tick changes (e.g. act node stopped it)
        const dbGraph = store.getGraph(taskId);
        if (dbGraph?.schedule?.state === 'stopped') {
          console.log(`[schedules:poll] ${taskId} schedule was stopped mid-tick, preserving stopped state`);
          completed.schedule = {
            ...completed.schedule,
            state: 'stopped',
          } as GraphSchedule;
        }

        store.updateGraphStructure(completed.id, {
          nodes: completed.nodes,
          schedule: completed.schedule,
        });
      }

      result.tickedGraphIds.push(taskId);
    } catch (err) {
      console.error(`[schedules:poll] ${taskId} caught error:`, err);
      result.errors.push({
        graphId: taskId,
        error: err instanceof Error ? err : new Error(String(err)),
      });
      // Unstick the tick so future polls aren't permanently blocked
      try {
        const latest = store.getGraph(taskId);
        if (latest?.schedule?.tickInProgress) {
          const unstuck = completeScheduleTick(latest);
          store.updateGraphStructure(unstuck.id, {
            nodes: unstuck.nodes,
            schedule: unstuck.schedule,
          });
          console.log(`[schedules:poll] ${taskId} force-completed stuck tick`);
        }
      } catch { /* best effort */ }
    }
  }

  return result;
}

/**
 * Execute a single scheduled graph until tick completes.
 * This is useful for testing or manual triggering.
 */
export async function executeScheduleTick(
  taskId: string,
  context: ExecutorContext = {},
): Promise<{ fired: boolean; graph: ExecutionGraph | null; error?: Error }> {
  const store = new GraphStore();
  const graph = store.getGraph(taskId);

  if (!graph) {
    return { fired: false, graph: null, error: new Error('Graph not found') };
  }

  if (!graph.schedule) {
    return { fired: false, graph, error: new Error('No schedule on graph') };
  }

  // Atomic claim: only proceed if tickInProgress is currently false
  const claimed = store.claimScheduleTick(taskId);
  if (!claimed) {
    return { fired: false, graph, error: new Error('Tick already in progress') };
  }

  // Re-read graph after atomic claim (tickInProgress is now true in DB)
  const claimedGraph = store.getGraph(taskId) ?? graph;

  const tickResult = scheduleTickIfDue(claimedGraph);
  if (!tickResult.tickFired) {
    // Release the claim since we won't execute
    const released = completeScheduleTick(claimedGraph);
    store.updateGraphStructure(released.id, {
      nodes: released.nodes,
      schedule: released.schedule,
    });
    return { fired: false, graph: tickResult.graph };
  }

  // Persist reset nodes
  store.updateGraphStructure(tickResult.graph.id, {
    nodes: tickResult.graph.nodes,
    schedule: tickResult.graph.schedule,
  });

  // Run scheduler and execute nodes
  let currentGraph = tickResult.graph;
  let loopCount = 0;

  try {
  while (true) {
    loopCount++;
    const nodesBefore = Object.entries(currentGraph.nodes).map(([id, n]) => `${id}:${n.status}`).join(', ');
    console.log(`[schedules:tick] loop ${loopCount} nodes before: ${nodesBefore}`);

    const schedulerResult = schedulerTick(currentGraph, context);
    console.log(`[schedules:tick] loop ${loopCount} fn=${schedulerResult.functionToRun.length} work=${schedulerResult.workToRun.length} cond=${schedulerResult.control.conditionalNodeIds.length}`);

    // Execute all runnable function nodes
    for (const nodeId of schedulerResult.functionToRun) {
      const node = currentGraph.nodes[nodeId];
      if (!node || node.type !== 'function') continue;

      const execResult = await executeNode(currentGraph, nodeId, context);
      currentGraph = execResult.graph;
      console.log(`[schedules:tick] fn "${nodeId}" → ${currentGraph.nodes[nodeId]?.status}`);
    }

    // Conditionals are evaluated in schedulerTick — update currentGraph
    if (schedulerResult.control.conditionalNodeIds.length > 0) {
      currentGraph = schedulerResult.graph;
      console.log(`[schedules:tick] applied conditional results: ${schedulerResult.control.conditionalNodeIds.join(', ')}`);
    }

    // Execute work nodes (if any runnable)
    for (const nodeId of schedulerResult.workToRun) {
      const execResult = await executeNode(currentGraph, nodeId, context);
      currentGraph = execResult.graph;
    }

    const nodesAfter = Object.entries(currentGraph.nodes).map(([id, n]) => `${id}:${n.status}`).join(', ');
    console.log(`[schedules:tick] loop ${loopCount} nodes after: ${nodesAfter}`);

    // If tick is complete, break
    if (isScheduleTickComplete(currentGraph)) {
      console.log(`[schedules:tick] tick complete after loop ${loopCount}`);
      break;
    }

    // Check for completion
    if (schedulerResult.complete) {
      break;
    }

    // Prevent infinite loop - check for runnable work
    const hasRunnable =
      schedulerResult.workToRun.length > 0 ||
      schedulerResult.functionToRun.length > 0;

    if (!hasRunnable) {
      break;
    }
  }

  // Persist final state
  const finalGraph = completeScheduleTick(currentGraph);
  store.updateGraphStructure(finalGraph.id, {
    nodes: finalGraph.nodes,
    schedule: finalGraph.schedule,
  });

  return { fired: true, graph: finalGraph };
  } catch (err) {
    // Release tickInProgress on failure to prevent stranding the lock
    const released = completeScheduleTick(currentGraph);
    store.updateGraphStructure(released.id, {
      nodes: released.nodes,
      schedule: released.schedule,
    });
    throw err;
  }
}
