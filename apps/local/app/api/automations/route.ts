import { NextRequest, NextResponse } from 'next/server';
import { getSQLiteDb } from '@/lib/sqlite-query-adapter';
import {
  automationRecordToGraphSchedule,
  getAutomationRepository,
  isAutomationDualReadEnabled,
  isAutomationFrontmatterEnabled,
} from '@/src/automations';
import type { GraphSchedule } from '@/src/graph/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ScheduleRow {
  task_id: string;
  id: string;
  schedule: string;
  execution_state: string;
  created_at: string;
  updated_at: string;
}

export interface AutomationItem {
  taskId: string;
  graphId: string;
  schedule: GraphSchedule;
  executionState: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /api/automations
 * Lists all graphs that have schedules (active, paused, or stopped).
 */
export async function GET(request: NextRequest) {
  try {
    const stateFilter = request.nextUrl.searchParams.get('state');
    const db = getSQLiteDb();
    const rows = db.prepare(`
      SELECT task_id, id, schedule, execution_state, created_at, updated_at
      FROM execution_graphs
      WHERE schedule IS NOT NULL
      ORDER BY updated_at DESC
    `).all() as unknown as ScheduleRow[];

    const rowByGraphId = new Map(rows.map((row) => [row.id, row]));
    const automationsByGraphId = new Map<string, AutomationItem>();

    if (isAutomationFrontmatterEnabled()) {
      for (const record of getAutomationRepository().listVisibleAutomations({
        targetType: 'execution_graph',
        ...(stateFilter ? { state: stateFilter as GraphSchedule['state'] } : {}),
      })) {
        if (record.definition.target.type !== 'execution_graph') {
          continue;
        }

        const graphId = record.definition.target.graphId ?? record.definition.id;
        const legacyRow = rowByGraphId.get(graphId);
        const taskId = record.definition.target.taskId ?? legacyRow?.task_id ?? graphId;
        automationsByGraphId.set(graphId, {
          taskId,
          graphId,
          schedule: automationRecordToGraphSchedule(record, legacyRow ? JSON.parse(legacyRow.schedule) as GraphSchedule : undefined),
          executionState: legacyRow?.execution_state ?? 'ready',
          createdAt: record.definition.createdAt ?? legacyRow?.created_at ?? record.runtimeState.updatedAt,
          updatedAt: record.runtimeState.updatedAt,
        });
      }

      if (!isAutomationDualReadEnabled()) {
        const automations = [...automationsByGraphId.values()].sort((left, right) => (
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
        ));
        return NextResponse.json({
          count: automations.length,
          automations,
        });
      }
    }

    for (const row of rows) {
      if (automationsByGraphId.has(row.id)) {
        continue;
      }

      const schedule = JSON.parse(row.schedule) as GraphSchedule;
      if (stateFilter && schedule.state !== stateFilter) {
        continue;
      }

      automationsByGraphId.set(row.id, {
        taskId: row.task_id,
        graphId: row.id,
        schedule,
        executionState: row.execution_state,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }

    const automations = [...automationsByGraphId.values()].sort((left, right) => (
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    ));

    return NextResponse.json({
      count: automations.length,
      automations,
    });
  } catch (error) {
    console.error('Failed to list automations:', error);
    return NextResponse.json(
      { error: 'Failed to list automations', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
