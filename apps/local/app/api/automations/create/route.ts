import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { toCronExpr } from '@/src/graph/nl-schedule';
import { parseBody } from "@/lib/parse-body";
import {
  createGraph,
  getGraph,
} from '@/src/graph/store';
import { activateGraphSchedule, type CreateGraphScheduleInput } from '@/src/graph/scheduler';
import type { ExecutionGraph, FunctionNode } from '@/src/graph/types';
import { createThreadMonitorSchedule } from '@/src/graph/schedule';
import { logger } from "@/lib/logger";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateAutomationSchema = z.object({
  /** Human-readable name for the automation */
  name: z.string().trim().min(1),
  /** Optional description */
  description: z.string().trim().min(1).optional(),
  /** Schedule cadence: cron expression or natural language (e.g. "every 2 hours") */
  cadence: z.string().trim().min(1),
  /** Optional: attach to existing task ID */
  taskId: z.string().trim().min(1).optional(),
  /** Optional: shell command to run on each tick */
  command: z.string().trim().min(1).optional(),
  /** Max number of runs */
  maxRuns: z.number().int().positive().optional(),
  /** Auto-pause after N consecutive failures */
  maxConsecutiveFailures: z.number().int().positive().optional(),
});

/**
 * POST /api/automations/create
 *
 * Create a new automation from natural language or cron expression.
 * If no taskId is provided, creates a new minimal graph.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = await parseBody(request);
    if (!parsedBody.ok) return parsedBody.response;
    const rawBody = parsedBody.body;
    const parsed = CreateAutomationSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const body = parsed.data;

    // Parse cadence
    const cronResult = toCronExpr(body.cadence);
    if (!cronResult) {
      return NextResponse.json(
        { error: `Could not parse cadence: "${body.cadence}". Use a cron expression or natural language like "every 2 hours".` },
        { status: 400 },
      );
    }

    // If attaching to existing task
    if (body.taskId) {
      const graph = getGraph(body.taskId);
      if (!graph) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      }

      const input: CreateGraphScheduleInput = {
        intervalMs: 60_000, // fallback, cron takes precedence
        cronExpr: cronResult.cronExpr,
        cadence: cronResult.cadence,
        name: body.name,
        description: body.description,
        resetNodeIds: Object.entries(graph.nodes)
          .filter(([, n]) => n.type === 'function' || n.type === 'conditional')
          .map(([id]) => id),
        maxRuns: body.maxRuns,
        maxConsecutiveFailures: body.maxConsecutiveFailures,
      };

      const scheduled = activateGraphSchedule(graph, input);
      const { updateGraphStructure } = await import('@/src/graph/store');
      updateGraphStructure(scheduled.id, {
        mode: scheduled.mode,
        nodes: scheduled.nodes,
        edges: scheduled.edges,
        policy: scheduled.policy,
        doneCriteria: scheduled.doneCriteria,
        schedule: scheduled.schedule,
      }, graph.graphVersion);

      const fresh = getGraph(body.taskId);
      return NextResponse.json({
        success: true,
        taskId: body.taskId,
        graphId: fresh?.id ?? scheduled.id,
        schedule: fresh?.schedule ?? scheduled.schedule,
      });
    }

    // Create a new minimal graph with a single function node
    const now = new Date().toISOString();
    const graphId = `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const taskId = graphId;

    const commandNode: FunctionNode = {
      type: 'function',
      status: 'pending',
      deps: [],
      kind: 'bash',
      title: body.name,
      command: body.command ?? 'echo "Automation tick"',
    };

    const resetNodeIds = ['run'];
    const graph: ExecutionGraph = {
      id: graphId,
      taskId,
      graphVersion: 1,
      mode: 'SIMPLE',
      nodes: {
        run: commandNode,
      },
      edges: [],
      policy: {
        replanBudgetRemaining: 0,
        replanBudgetInitial: 0,
        verifyBudgetRemaining: 0,
        verifyBudgetInitial: 0,
        maxConcurrentAutoChecks: 0,
        immutableRequiredGates: false,
        maxConcurrent: 1,
        priorityMode: 'fifo',
        nodeTimeoutMs: 5 * 60_000,
        graphTimeoutMs: 10 * 60_000,
      },
      doneCriteria: {
        allRequiredGatesPassed: true,
        noRunnableOrPendingWork: true,
      },
      schedule: {
        ...createThreadMonitorSchedule(resetNodeIds, 60_000),
        cronExpr: cronResult.cronExpr,
        cadence: cronResult.cadence,
        name: body.name,
        description: body.description,
        maxConsecutiveFailures: body.maxConsecutiveFailures,
        consecutiveFailures: 0,
        maxRuns: body.maxRuns,
      },
      versionHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    createGraph(graph);

    return NextResponse.json({
      success: true,
      created: true,
      taskId,
      graphId,
      schedule: graph.schedule,
      parsedCron: cronResult,
    });
  } catch (error) {
    logger.error('Create automation error', logger.formatError(error));
    return NextResponse.json(
      { error: 'Failed to create automation', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
