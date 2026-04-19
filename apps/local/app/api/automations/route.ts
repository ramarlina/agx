import { NextRequest, NextResponse } from 'next/server';
import { getSQLiteDb } from '@/lib/sqlite-query-adapter';
import {
  automationRecordToGraphSchedule,
  getAutomationRepository,
  isAutomationDualReadEnabled,
  isAutomationFrontmatterEnabled,
} from '@/src/automations';
import type { GraphSchedule } from '@/src/graph/types';
import { resolveAutomationTitle } from '@/lib/project-overview-titles';
import { logger } from "@/lib/logger";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ScheduleRow {
  task_id: string;
  id: string;
  schedule: string;
  execution_state: string;
  created_at: string;
  updated_at: string;
  task_title: string | null;
  task_content: string | null;
  project_id: string | null;
}

export interface AutomationItem {
  taskId: string;
  graphId: string;
  title: string;
  projectId: string | null;
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
      SELECT
        eg.task_id,
        eg.id,
        eg.schedule,
        eg.execution_state,
        eg.created_at,
        eg.updated_at,
        t.title AS task_title,
        t.content AS task_content,
        t.project_id AS project_id
      FROM execution_graphs eg
      LEFT JOIN tasks t ON t.id = eg.task_id
      WHERE eg.schedule IS NOT NULL
      ORDER BY eg.updated_at DESC
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
        const title = resolveAutomationTitle({
          automationName: record.definition.name,
          graphId,
          taskTitle: legacyRow?.task_title,
          taskContent: legacyRow?.task_content,
        });
        const schedule = automationRecordToGraphSchedule(
          record,
          legacyRow ? JSON.parse(legacyRow.schedule) as GraphSchedule : undefined,
        );
        const scheduleName = schedule.name?.trim();

        automationsByGraphId.set(graphId, {
          taskId,
          graphId,
          title,
          projectId: record.definition.projectId ?? legacyRow?.project_id ?? null,
          schedule: scheduleName && scheduleName !== graphId
            ? schedule
            : { ...schedule, name: title },
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

      const title = resolveAutomationTitle({
        automationName: schedule.name,
        graphId: row.id,
        taskTitle: row.task_title,
        taskContent: row.task_content,
      });
      const scheduleName = schedule.name?.trim();

      automationsByGraphId.set(row.id, {
        taskId: row.task_id,
        graphId: row.id,
        title,
        projectId: row.project_id ?? null,
        schedule: scheduleName && scheduleName !== row.id
          ? schedule
          : { ...schedule, name: title },
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
    logger.error('Failed to list automations', logger.formatError(error));
    return NextResponse.json(
      { error: 'Failed to list automations', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
