import { NextRequest, NextResponse } from 'next/server';
import { GraphStore } from '@/src/graph/store';
import { scheduleTickIfDue, isScheduleTickComplete } from '@/src/graph/schedule';
import { schedulerTick } from '@/src/graph/scheduler';
import { executeNode } from '@/src/graph/executor';
import { createDispatchFunction } from '@/src/graph/function-executor';
import { createDispatchWork } from '@/src/graph/work-dispatcher';
import type { ExecutionGraph, ConditionalNode, FunctionNode } from '@/src/graph/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/schedules/debug?rootMessageId=<id>&run=1
 *
 * Step through a schedule tick with clear input → processing → output for each node.
 * Loops until all nodes are terminal (like the real executor).
 * Add &run=1 to actually execute (live curl, agent steer).
 */
export async function GET(request: NextRequest) {
  const rootMessageId = request.nextUrl.searchParams.get('rootMessageId');
  const shouldRun = request.nextUrl.searchParams.get('run') === '1';

  if (!rootMessageId) {
    return NextResponse.json({ error: 'rootMessageId required' }, { status: 400 });
  }

  const store = new GraphStore();
  const graph = store.getGraph(rootMessageId);

  if (!graph) {
    return NextResponse.json({ error: 'Graph not found' }, { status: 404 });
  }

  // ── Workflow overview ─────────────────────────────────────────────────
  const workflow = {
    id: graph.id,
    schedule: {
      state: graph.schedule?.state,
      intervalMs: graph.schedule?.intervalMs,
      runCount: graph.schedule?.runCount,
      tickInProgress: graph.schedule?.tickInProgress,
      lastTickAt: graph.schedule?.lastTickAt
        ? new Date(graph.schedule.lastTickAt).toISOString()
        : null,
    },
    pipeline: graph.edges.map((e) => {
      const from = graph.nodes[e.from];
      const to = graph.nodes[e.to];
      return `[${e.from}] (${from?.type}:${from?.status}) ─${e.type}→ [${e.to}] (${to?.type}:${to?.status})`;
    }),
    nodes: Object.fromEntries(
      Object.entries(graph.nodes).map(([id, n]) => {
        const info: Record<string, unknown> = { type: n.type, status: n.status };
        if (n.type === 'function') {
          const fn = n as FunctionNode;
          info.kind = fn.kind;
          info.command = fn.command;
        }
        if (n.type === 'conditional') {
          const cn = n as ConditionalNode;
          info.expression = cn.condition.expression;
          info.inputFrom = cn.condition.inputFrom;
          if ('evaluatedTo' in cn) info.evaluatedTo = cn.evaluatedTo;
        }
        if ('output' in n && n.output) info.output = n.output;
        if ('deps' in n) info.deps = n.deps;
        return [id, info];
      })
    ),
  };

  // ── Tick check ────────────────────────────────────────────────────────
  const tickResult = scheduleTickIfDue(graph);
  const tickCheck = {
    tickFired: tickResult.tickFired,
    ...(!tickResult.tickFired && 'skipReason' in tickResult
      ? { skipReason: (tickResult as any).skipReason }
      : {}),
  };

  if (!tickResult.tickFired) {
    return NextResponse.json({ workflow, tickCheck, nodes: [] });
  }

  // ── Loop through scheduler passes until tick completes ────────────────
  const nodes: Record<string, unknown>[] = [];
  let currentGraph: ExecutionGraph = tickResult.graph;
  const dispatchFunction = createDispatchFunction();
  const dispatchWork = createDispatchWork();
  const MAX_LOOPS = 10;

  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    const pass = schedulerTick(currentGraph);
    currentGraph = pass.graph; // apply conditional evaluations

    const hasWork =
      pass.functionToRun.length > 0 ||
      pass.workToRun.length > 0 ||
      pass.control.conditionalNodeIds.length > 0;

    if (!hasWork) break;

    // Log conditionals evaluated this pass
    for (const nodeId of pass.control.conditionalNodeIds) {
      const node = currentGraph.nodes[nodeId];
      if (!node || node.type !== 'conditional') continue;
      const cn = node as ConditionalNode;
      const sourceNode = currentGraph.nodes[cn.condition.inputFrom];
      const sourceOutput = sourceNode && 'output' in sourceNode ? sourceNode.output : null;

      nodes.push({
        node: nodeId,
        type: 'conditional',
        input: {
          expression: cn.condition.expression,
          inputFrom: cn.condition.inputFrom,
          sourceOutput,
        },
        processing: `evaluated "${cn.condition.expression}"`,
        output: {
          status: cn.status,
          evaluatedTo: 'evaluatedTo' in cn ? (cn as any).evaluatedTo : null,
          thenBranch: cn.thenBranch,
          elseBranch: cn.elseBranch,
        },
      });
    }

    // Execute function nodes
    for (const nodeId of pass.functionToRun) {
      const node = currentGraph.nodes[nodeId];
      if (!node || node.type !== 'function') continue;
      const fn = node as FunctionNode;

      const entry: Record<string, unknown> = {
        node: nodeId,
        type: 'function',
        kind: fn.kind,
        input: {
          command: fn.command,
          timeoutMs: fn.timeoutMs ?? 30000,
        },
        processing: shouldRun ? 'executing...' : 'skipped (add &run=1)',
      };

      if (shouldRun) {
        const startMs = Date.now();
        try {
          const execResult = await executeNode(currentGraph, nodeId, { dispatchFunction });
          currentGraph = execResult.graph;
          const resultNode = currentGraph.nodes[nodeId];
          entry.processing = `executed in ${Date.now() - startMs}ms`;
          entry.output = {
            status: resultNode?.status,
            data: resultNode && 'output' in resultNode ? resultNode.output : null,
            errors: resultNode && 'errors' in resultNode ? (resultNode as any).errors : null,
          };
        } catch (err) {
          entry.processing = `failed after ${Date.now() - startMs}ms`;
          entry.output = { status: 'error', error: err instanceof Error ? err.message : String(err) };
        }
      } else {
        entry.output = '(not executed)';
      }

      nodes.push(entry);
    }

    // Log work nodes (not executed by debug endpoint)
    for (const nodeId of pass.workToRun) {
      const node = currentGraph.nodes[nodeId];
      const entry: Record<string, unknown> = {
        node: nodeId,
        type: 'work',
        input: node,
        processing: shouldRun ? 'executing...' : 'ready to dispatch (add &run=1)',
        output: { status: node?.status },
      };

      if (shouldRun && node?.type === 'work') {
        const startMs = Date.now();
        try {
          const execResult = await executeNode(currentGraph, nodeId, { dispatchFunction, dispatchWork });
          currentGraph = execResult.graph;
          entry.processing = `executed in ${Date.now() - startMs}ms`;
          entry.output = {
            status: currentGraph.nodes[nodeId]?.status,
            data: 'output' in currentGraph.nodes[nodeId] ? currentGraph.nodes[nodeId].output : null,
          };
        } catch (err) {
          entry.processing = `failed after ${Date.now() - startMs}ms`;
          entry.output = { status: 'error', error: err instanceof Error ? err.message : String(err) };
        }
      }

      nodes.push(entry);
    }

    if (isScheduleTickComplete(currentGraph)) break;
  }

  // ── Completion check ──────────────────────────────────────────────────
  const tickComplete = isScheduleTickComplete(currentGraph);
  const completion = {
    complete: tickComplete,
    resetNodes: graph.schedule?.resetNodeIds.map((id) => ({
      id,
      status: currentGraph.nodes[id]?.status,
    })),
  };

  return NextResponse.json({ workflow, tickCheck, nodes, completion });
}
