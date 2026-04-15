import { getSQLiteDb } from "@/lib/sqlite-query-adapter";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { pragmaSet, transaction } from "@/lib/sqlite-compat";
import {
  automationRecordToGraphSchedule,
  getAutomationRepository,
  graphAutomationToDefinition,
  isAutomationDualReadEnabled,
  isAutomationFrontmatterEnabled,
} from "@/src/automations";

import type {
  Edge,
  ExecutionGraph,
  GraphEvent,
  GraphNode,
  NodeMetrics,
  NodeStatus,
  RuntimeEvent,
  VersionHistoryEvent,
} from "./types";

const VERSION_HISTORY_EVENT_TYPES = new Set<GraphEvent["eventType"]>(["replan", "rollback"]);

type QueryResultRow = Record<string, unknown>;

interface QueryResult<T extends QueryResultRow = QueryResultRow> {
  rows: T[];
}

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): QueryResult<T>;
}

export interface NodeRuntimeUpdate {
  status?: NodeStatus;
  metrics?: NodeMetrics;
  output?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  actualMinutes?: number;
  configPatch?: Record<string, unknown>;
}

export interface NodeRuntimeUpdateResult {
  graphVersion: number;
  updatedAt: string;
}

export interface GraphStructureUpdate {
  mode?: ExecutionGraph["mode"];
  nodes?: Record<string, GraphNode>;
  edges?: Edge[];
  policy?: ExecutionGraph["policy"];
  doneCriteria?: ExecutionGraph["doneCriteria"];
  schedule?: ExecutionGraph["schedule"];
}

export class GraphVersionConflictError extends Error {
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `Execution graph version conflict: expected ${expectedVersion}, found ${actualVersion}.`,
    );
    this.name = "GraphVersionConflictError";
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class GraphNotFoundError extends Error {
  constructor(graphId: string) {
    super(`Execution graph not found: ${graphId}`);
    this.name = "GraphNotFoundError";
  }
}

export class GraphNodeNotFoundError extends Error {
  readonly nodeIds: string[];

  constructor(graphId: string, nodeIds: string[]) {
    super(`Execution graph ${graphId} is missing node(s): ${nodeIds.join(", ")}`);
    this.name = "GraphNodeNotFoundError";
    this.nodeIds = nodeIds;
  }
}

export class GraphTaskAlreadyBoundError extends Error {
  readonly taskId: string;
  readonly existingGraphId: string;

  constructor(taskId: string, existingGraphId: string) {
    super(`Task ${taskId} is already bound to execution graph ${existingGraphId}.`);
    this.name = "GraphTaskAlreadyBoundError";
    this.taskId = taskId;
    this.existingGraphId = existingGraphId;
  }
}

interface ExecutionGraphRow extends QueryResultRow {
  id: string;
  task_id: string;
  graph_version: number;
  mode: ExecutionGraph["mode"];
  execution_state: string | null;
  policy: string | ExecutionGraph["policy"] | null;
  done_criteria: string | ExecutionGraph["doneCriteria"] | null;
  schedule: string | ExecutionGraph["schedule"] | null;
  created_at: string;
  updated_at: string;
}

interface GraphNodeRow extends QueryResultRow {
  node_id: string;
  type: GraphNode["type"];
  status: NodeStatus;
  config: string | Record<string, unknown> | null;
  output: string | Record<string, unknown> | null;
  metrics: string | NodeMetrics | null;
}

interface GraphEdgeRow extends QueryResultRow {
  from_id: string;
  to_id: string;
  type: Edge["type"];
  condition: string | Edge["condition"] | null;
  data_mapping: string | Edge["dataMapping"] | null;
}

interface GraphEventRow extends QueryResultRow {
  event_type: GraphEvent["eventType"];
  payload: string | Record<string, unknown> | null;
  timestamp: string;
}

function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function parseJson(value: unknown): any {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function toIsoString(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function syncGraphAutomationRecord(graph: ExecutionGraph): void {
  if (!isAutomationFrontmatterEnabled() || !graph.schedule) {
    return;
  }

  const repository = getAutomationRepository();
  const definition = graphAutomationToDefinition({
    graphId: graph.id,
    taskId: graph.taskId,
    schedule: graph.schedule,
    createdAt: graph.createdAt,
    updatedAt: graph.updatedAt,
    executionState: graph.executionState,
  });

  repository.upsertAutomation(definition);
  repository.updateAutomationState(graph.id, {
    nextRunAt: graph.schedule.nextTickAt,
    lastRunAt: graph.schedule.lastTickAt,
    updatedAt: graph.updatedAt,
    runCount: graph.schedule.runCount,
    consecutiveFailures: graph.schedule.consecutiveFailures,
    tickInProgress: graph.schedule.tickInProgress,
    currentConcurrency: graph.schedule.currentConcurrency,
  });
}

function overlayGraphScheduleFromRepository(graph: ExecutionGraph): ExecutionGraph {
  if (!isAutomationFrontmatterEnabled()) {
    return graph;
  }

  const record = getAutomationRepository().getAutomation(graph.id);
  if (!record || record.definition.target.type !== "execution_graph") {
    return graph;
  }

  return {
    ...graph,
    schedule: automationRecordToGraphSchedule(record, graph.schedule),
  };
}

export function getTaskIdForGraphId(graphId: string): string | null {
  const normalized = graphId.trim();
  if (!normalized) {
    return null;
  }

  const db = getSQLiteDb();
  const row = db
    .prepare(
      `SELECT task_id AS taskId
       FROM execution_graphs
       WHERE id = ?
       LIMIT 1`,
    )
    .get(normalized) as { taskId: string } | undefined;

  return row?.taskId ?? null;
}

function splitNodeForStorage(node: GraphNode): {
  type: GraphNode["type"];
  status: NodeStatus;
  config: Record<string, unknown>;
  output: Record<string, unknown> | null;
  metrics: NodeMetrics | null;
} {
  const source = node as GraphNode & { output?: Record<string, unknown> };
  const { type, status, metrics, output, ...config } = source;
  return { type, status, config, output: output ?? null, metrics: metrics ?? null };
}

function hydrateNode(row: GraphNodeRow): GraphNode {
  const node = {
    ...asRecord(parseJson(row.config)),
    type: row.type,
    status: row.status,
  } as GraphNode & { output?: Record<string, unknown> };

  const metrics = parseJson(row.metrics);
  if (metrics !== null) node.metrics = metrics;

  const output = parseJson(row.output);
  if (output !== null) node.output = output;

  return node;
}

function normalizeGraphEvent(row: GraphEventRow): GraphEvent {
  const payload = asRecord(parseJson(row.payload));
  const normalized = { ...payload };
  if (!("eventType" in normalized)) normalized.eventType = row.event_type;
  if (!("timestamp" in normalized)) normalized.timestamp = toIsoString(row.timestamp);
  return normalized as unknown as GraphEvent;
}

/** Thin wrapper so internal methods can use a consistent query interface */
function makeSQLiteQueryable(db: DatabaseSync): Queryable {
  return {
    query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): QueryResult<T> {
      const stmt = db.prepare(text);
      const isWrite = /^\s*(INSERT|UPDATE|DELETE)/i.test(text);
      if (isWrite && !/RETURNING/i.test(text)) {
        stmt.run(...(params ?? []).map(v => v as SQLInputValue));
        return { rows: [] as T[] };
      }
      const rows = stmt.all(...(params ?? []).map(v => v as SQLInputValue)) as T[];
      return { rows };
    },
  };
}

export class GraphStore {
  private getDb(): DatabaseSync {
    return getSQLiteDb();
  }

  createGraph(graph: ExecutionGraph, opts?: { skipTaskBinding?: boolean }): ExecutionGraph {
    const db = this.getDb();
    const q = makeSQLiteQueryable(db);

    if (opts?.skipTaskBinding) {
      pragmaSet(db, "foreign_keys = OFF");
    }

    try { return transaction(db, () => {
      const existingResult = q.query<Pick<ExecutionGraphRow, "id">>(
        `SELECT id FROM execution_graphs WHERE task_id = ? LIMIT 1`,
        [graph.taskId],
      );
      const existing = existingResult.rows[0];
      if (existing && existing.id !== graph.id) {
        throw new GraphTaskAlreadyBoundError(graph.taskId, existing.id);
      }

      q.query(
        `INSERT INTO execution_graphs
          (id, task_id, graph_version, mode, policy, done_criteria, schedule, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           task_id = excluded.task_id,
           graph_version = excluded.graph_version,
           mode = excluded.mode,
           policy = excluded.policy,
           done_criteria = excluded.done_criteria,
           schedule = excluded.schedule,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        [
          graph.id, graph.taskId, graph.graphVersion, graph.mode,
          toJson(graph.policy), toJson(graph.doneCriteria),
          toJson(graph.schedule ?? null),
          graph.createdAt, graph.updatedAt,
        ],
      );

      q.query("DELETE FROM graph_nodes WHERE graph_id = ?", [graph.id]);
      q.query("DELETE FROM graph_edges WHERE graph_id = ?", [graph.id]);

      for (const [nodeId, node] of Object.entries(graph.nodes)) {
        const stored = splitNodeForStorage(node);
        q.query(
          `INSERT INTO graph_nodes (graph_id, node_id, type, status, config, output, metrics)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [graph.id, nodeId, stored.type, stored.status,
           toJson(stored.config), toJson(stored.output), toJson(stored.metrics)],
        );
      }

      for (const edge of graph.edges) {
        q.query(
          `INSERT INTO graph_edges (graph_id, from_id, to_id, type, condition, data_mapping)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [graph.id, edge.from, edge.to, edge.type,
           edge.condition ?? null, toJson(edge.dataMapping ?? null)],
        );
      }

      for (const event of graph.versionHistory) {
        this.appendEventInternal(q, graph.id, event);
      }
      for (const event of graph.runtimeEvents ?? []) {
        this.appendEventInternal(q, graph.id, event);
      }

      if (!opts?.skipTaskBinding) {
        q.query("UPDATE tasks SET graph_id = ? WHERE id = ?", [graph.id, graph.taskId]);
      }

      const persisted = this.getGraphForTask(q, graph.taskId);
      if (!persisted) throw new GraphNotFoundError(graph.id);
      syncGraphAutomationRecord(persisted);
      return persisted;
    }); } finally {
      if (opts?.skipTaskBinding) {
        pragmaSet(db, "foreign_keys = ON");
      }
    }
  }

  getGraph(taskId: string): ExecutionGraph | null {
    const db = this.getDb();
    return this.getGraphForTask(makeSQLiteQueryable(db), taskId);
  }

  updateNodeRuntime(
    graphId: string,
    nodeUpdates: Record<string, NodeRuntimeUpdate>,
    _ifMatchGraphVersion?: number,
  ): NodeRuntimeUpdateResult {
    const db = this.getDb();
    const q = makeSQLiteQueryable(db);

    return transaction(db, () => {
      const graphResult = q.query<Pick<ExecutionGraphRow, "id" | "graph_version">>(
        `SELECT id, graph_version FROM execution_graphs WHERE id = ?`,
        [graphId],
      );
      const graph = graphResult.rows[0];
      if (!graph) throw new GraphNotFoundError(graphId);

      const nodeIds = Object.keys(nodeUpdates);
      if (nodeIds.length === 0) {
        const unchanged = q.query<Pick<ExecutionGraphRow, "graph_version" | "updated_at">>(
          `SELECT graph_version, updated_at FROM execution_graphs WHERE id = ?`,
          [graphId],
        );
        return {
          graphVersion: unchanged.rows[0].graph_version,
          updatedAt: toIsoString(unchanged.rows[0].updated_at),
        };
      }

      const placeholders = nodeIds.map(() => "?").join(", ");
      const currentNodesResult = q.query<GraphNodeRow>(
        `SELECT node_id, type, status, config, output, metrics
         FROM graph_nodes WHERE graph_id = ? AND node_id IN (${placeholders})`,
        [graphId, ...nodeIds],
      );

      const currentNodesById = new Map<string, GraphNodeRow>();
      for (const row of currentNodesResult.rows) {
        currentNodesById.set(row.node_id, row);
      }

      const missingNodeIds = nodeIds.filter((id) => !currentNodesById.has(id));
      if (missingNodeIds.length > 0) throw new GraphNodeNotFoundError(graphId, missingNodeIds);

      for (const nodeId of nodeIds) {
        const patch = nodeUpdates[nodeId];
        const current = currentNodesById.get(nodeId);
        if (!current || !patch) continue;

        const nextConfig = {
          ...asRecord(parseJson(current.config)),
          ...asRecord(patch.configPatch),
        };
        if (patch.startedAt !== undefined) nextConfig.startedAt = patch.startedAt;
        if (patch.completedAt !== undefined) nextConfig.completedAt = patch.completedAt;
        if (patch.actualMinutes !== undefined) nextConfig.actualMinutes = patch.actualMinutes;

        q.query(
          `UPDATE graph_nodes SET status = ?, metrics = ?, output = ?, config = ?
           WHERE graph_id = ? AND node_id = ?`,
          [
            patch.status ?? current.status,
            toJson(patch.metrics ?? parseJson(current.metrics)),
            toJson(patch.output ?? parseJson(current.output)),
            toJson(nextConfig),
            graphId, nodeId,
          ],
        );
      }

      const touchedGraph = q.query<Pick<ExecutionGraphRow, "graph_version" | "updated_at">>(
        `UPDATE execution_graphs SET updated_at = datetime('now') WHERE id = ? RETURNING graph_version, updated_at`,
        [graphId],
      );

      return {
        graphVersion: touchedGraph.rows[0].graph_version,
        updatedAt: toIsoString(touchedGraph.rows[0].updated_at),
      };
    });
  }

  updateGraphStructure(
    graphId: string,
    update: GraphStructureUpdate,
    _ifMatchGraphVersion?: number,
  ): NodeRuntimeUpdateResult {
    const db = this.getDb();
    const q = makeSQLiteQueryable(db);

    return transaction(db, () => {
      const graphResult = q.query<
        Pick<ExecutionGraphRow, "id" | "task_id" | "graph_version" | "mode" | "policy" | "done_criteria" | "schedule">
      >(
        `SELECT id, task_id, graph_version, mode, policy, done_criteria, schedule FROM execution_graphs WHERE id = ?`,
        [graphId],
      );
      const current = graphResult.rows[0];
      if (!current) throw new GraphNotFoundError(graphId);

      if (update.nodes) {
        q.query("DELETE FROM graph_nodes WHERE graph_id = ?", [graphId]);
        for (const [nodeId, node] of Object.entries(update.nodes)) {
          const stored = splitNodeForStorage(node);
          q.query(
            `INSERT INTO graph_nodes (graph_id, node_id, type, status, config, output, metrics)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [graphId, nodeId, stored.type, stored.status,
             toJson(stored.config), toJson(stored.output), toJson(stored.metrics)],
          );
        }
      }

      if (update.edges) {
        q.query("DELETE FROM graph_edges WHERE graph_id = ?", [graphId]);
        for (const edge of update.edges) {
          q.query(
            `INSERT INTO graph_edges (graph_id, from_id, to_id, type, condition, data_mapping)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [graphId, edge.from, edge.to, edge.type,
             edge.condition ?? null, toJson(edge.dataMapping ?? null)],
          );
        }
      }

      const touchedGraph = q.query<Pick<ExecutionGraphRow, "graph_version" | "updated_at">>(
        `UPDATE execution_graphs
         SET mode = ?, policy = ?, done_criteria = ?, schedule = ?, updated_at = datetime('now')
         WHERE id = ?
         RETURNING graph_version, updated_at`,
        [
          update.mode ?? current.mode,
          toJson(update.policy ?? parseJson(current.policy) ?? {}),
          toJson(update.doneCriteria ?? parseJson(current.done_criteria) ?? {}),
          toJson(update.schedule ?? parseJson(current.schedule) ?? null),
          graphId,
        ],
      );

      if (update.schedule !== undefined) {
        const persisted = this.getGraphForTask(q, current.task_id);
        if (persisted?.schedule) {
          syncGraphAutomationRecord(persisted);
        }
      }

      return {
        graphVersion: touchedGraph.rows[0].graph_version,
        updatedAt: toIsoString(touchedGraph.rows[0].updated_at),
      };
    });
  }

  appendEvent(graphId: string, event: GraphEvent): void {
    const db = this.getDb();
    this.appendEventInternal(makeSQLiteQueryable(db), graphId, event);
  }

  private getGraphForTask(client: Queryable, taskId: string): ExecutionGraph | null {
    const graphResult = client.query<ExecutionGraphRow>(
      `SELECT id, task_id, graph_version, mode, execution_state, policy, done_criteria, schedule, created_at, updated_at
       FROM execution_graphs WHERE task_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [taskId],
    );
    const graphRow = graphResult.rows[0];
    if (!graphRow) return null;

    const nodesResult = client.query<GraphNodeRow>(
      `SELECT node_id, type, status, config, output, metrics
       FROM graph_nodes WHERE graph_id = ? ORDER BY node_id ASC`,
      [graphRow.id],
    );

    const edgesResult = client.query<GraphEdgeRow>(
      `SELECT from_id, to_id, type, condition, data_mapping
       FROM graph_edges WHERE graph_id = ? ORDER BY from_id ASC, to_id ASC`,
      [graphRow.id],
    );

    const eventsResult = client.query<GraphEventRow>(
      `SELECT event_type, payload, timestamp
       FROM graph_events WHERE graph_id = ? ORDER BY timestamp ASC, event_type ASC`,
      [graphRow.id],
    );

    const nodes: Record<string, GraphNode> = {};
    for (const nodeRow of nodesResult.rows) {
      nodes[nodeRow.node_id] = hydrateNode(nodeRow);
    }

    const edges: Edge[] = edgesResult.rows.map((edgeRow) => ({
      from: edgeRow.from_id,
      to: edgeRow.to_id,
      type: edgeRow.type,
      ...(edgeRow.condition ? { condition: parseJson(edgeRow.condition) } : {}),
      ...(edgeRow.data_mapping ? { dataMapping: parseJson(edgeRow.data_mapping) } : {}),
    }));

    const versionHistory: VersionHistoryEvent[] = [];
    const runtimeEvents: RuntimeEvent[] = [];
    for (const eventRow of eventsResult.rows) {
      const event = normalizeGraphEvent(eventRow);
      if (VERSION_HISTORY_EVENT_TYPES.has(event.eventType)) {
        versionHistory.push(event as VersionHistoryEvent);
      } else {
        runtimeEvents.push(event as RuntimeEvent);
      }
    }

    return overlayGraphScheduleFromRepository({
      id: graphRow.id,
      taskId: graphRow.task_id,
      graphVersion: graphRow.graph_version,
      mode: graphRow.mode,
      executionState: (graphRow.execution_state as ExecutionGraph["executionState"]) ?? undefined,
      nodes,
      edges,
      policy: (parseJson(graphRow.policy) ?? {}) as ExecutionGraph["policy"],
      doneCriteria: (parseJson(graphRow.done_criteria) ?? {}) as ExecutionGraph["doneCriteria"],
      schedule: (parseJson(graphRow.schedule) ?? undefined) as ExecutionGraph["schedule"] | undefined,
      versionHistory,
      runtimeEvents,
      createdAt: toIsoString(graphRow.created_at),
      updatedAt: toIsoString(graphRow.updated_at),
    });
  }

  private appendEventInternal(client: Queryable, graphId: string, event: GraphEvent): void {
    client.query(
      `INSERT INTO graph_events (graph_id, event_type, payload, timestamp)
       VALUES (?, ?, ?, ?)`,
      [graphId, event.eventType, toJson(event), event.timestamp],
    );
  }

  claimScheduleTick(taskId: string): boolean {
    const db = this.getDb();
    const result = db.prepare(
      `UPDATE execution_graphs
       SET schedule = json_set(
         schedule,
         '$.tickInProgress', json('true'),
         '$.currentConcurrency',
           COALESCE(CAST(json_extract(schedule, '$.currentConcurrency') AS INTEGER), 0) + 1
       ),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE task_id = ?
         AND COALESCE(CAST(json_extract(schedule, '$.currentConcurrency') AS INTEGER), 0)
             < COALESCE(CAST(json_extract(schedule, '$.maxConcurrency') AS INTEGER), 5)
         AND json_extract(schedule, '$.state') = 'active'`,
    ).run(taskId);
    return (result.changes ?? 0) > 0;
  }

  releaseScheduleTick(taskId: string): void {
    const db = this.getDb();
    db.prepare(
      `UPDATE execution_graphs
       SET schedule = json_set(
         schedule,
         '$.currentConcurrency',
           MAX(0, COALESCE(CAST(json_extract(schedule, '$.currentConcurrency') AS INTEGER), 1) - 1),
         '$.tickInProgress',
           CASE WHEN COALESCE(CAST(json_extract(schedule, '$.currentConcurrency') AS INTEGER), 1) - 1 > 0
                THEN json('true') ELSE json('false') END
       ),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE task_id = ?`,
    ).run(taskId);
  }
}

export function createGraphStore(): GraphStore {
  return new GraphStore();
}

const defaultGraphStore = new GraphStore();

export function createGraph(graph: ExecutionGraph, opts?: { skipTaskBinding?: boolean }): ExecutionGraph {
  return defaultGraphStore.createGraph(graph, opts);
}

export function getGraph(taskId: string): ExecutionGraph | null {
  return defaultGraphStore.getGraph(taskId);
}

export function updateNodeRuntime(
  graphId: string,
  nodeUpdates: Record<string, NodeRuntimeUpdate>,
  ifMatchGraphVersion: number,
): NodeRuntimeUpdateResult {
  return defaultGraphStore.updateNodeRuntime(graphId, nodeUpdates, ifMatchGraphVersion);
}

export function updateGraphStructure(
  graphId: string,
  update: GraphStructureUpdate,
  ifMatchGraphVersion: number,
): NodeRuntimeUpdateResult {
  return defaultGraphStore.updateGraphStructure(graphId, update, ifMatchGraphVersion);
}

export function appendEvent(graphId: string, event: GraphEvent): void {
  return defaultGraphStore.appendEvent(graphId, event);
}

export interface GetGraphEventsOptions {
  eventType?: string;
  since?: string;
  limit?: number;
}

export function getGraphEvents(
  graphId: string,
  options: GetGraphEventsOptions = {},
): GraphEvent[] {
  const conditions = ['graph_id = ?'];
  const params: unknown[] = [graphId];

  if (options.eventType) {
    conditions.push('event_type = ?');
    params.push(options.eventType);
  }

  if (options.since) {
    conditions.push('timestamp >= ?');
    params.push(options.since);
  }

  const limit = options.limit ?? 1000;
  const sql = `SELECT event_type, payload, timestamp
    FROM graph_events
    WHERE ${conditions.join(' AND ')}
    ORDER BY timestamp ASC, event_type ASC
    LIMIT ?`;
  params.push(limit);

  const db = getSQLiteDb();
  const q = makeSQLiteQueryable(db);
  const result = q.query<GraphEventRow>(sql, params);
  return result.rows.map((row) => normalizeGraphEvent(row));
}

export function getActiveScheduleForRootMessageId(
  rootMessageId: string,
): { graphId: string; taskId: string } | null {
  const normalized = rootMessageId.trim();
  if (!normalized) {
    return null;
  }

  if (isAutomationFrontmatterEnabled()) {
    const record = getAutomationRepository()
      .listVisibleAutomations({
        targetType: "execution_graph",
        state: "active",
        rootMessageId: normalized,
      })[0];

    if (record?.definition.target.type === "execution_graph") {
      const graphId = record.definition.target.graphId ?? record.definition.id;
      const taskId = record.definition.target.taskId ?? getTaskIdForGraphId(graphId);
      if (taskId) {
        return {
          graphId,
          taskId,
        };
      }
    }

    if (!isAutomationDualReadEnabled()) {
      return null;
    }
  }

  const db = getSQLiteDb();
  const row = db
    .prepare(
      `SELECT id AS graphId, task_id AS taskId
       FROM execution_graphs
       WHERE schedule IS NOT NULL
         AND json_extract(schedule, '$.rootMessageId') = ?
         AND json_extract(schedule, '$.state') = 'active'
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(normalized) as { graphId: string; taskId: string } | undefined;

  return row ?? null;
}

/**
 * Return all rootMessageIds that have an active schedule.
 */
export function getActiveScheduleRootMessageIds(): string[] {
  const ids = new Set<string>();

  if (isAutomationFrontmatterEnabled()) {
    for (const record of getAutomationRepository().listVisibleAutomations({
      targetType: "execution_graph",
      state: "active",
    })) {
      if (record.definition.target.type === "execution_graph" && record.definition.target.rootMessageId) {
        ids.add(record.definition.target.rootMessageId);
      }
    }

    if (!isAutomationDualReadEnabled()) {
      return [...ids];
    }
  }

  const db = getSQLiteDb();
  const rows = db
    .prepare(
      `SELECT json_extract(schedule, '$.rootMessageId') AS rootMessageId
       FROM execution_graphs
       WHERE schedule IS NOT NULL
         AND json_extract(schedule, '$.state') = 'active'`,
    )
    .all() as { rootMessageId: string }[];
  for (const row of rows) {
    if (row.rootMessageId) {
      ids.add(row.rootMessageId);
    }
  }
  return [...ids];
}

export function deactivateSchedulesByRootMessageId(rootMessageId: string): number {
  const normalized = rootMessageId.trim();
  if (!normalized) {
    return 0;
  }

  let changes = 0;
  if (isAutomationFrontmatterEnabled()) {
    const records = getAutomationRepository().listVisibleAutomations({
      targetType: "execution_graph",
      state: "active",
      rootMessageId: normalized,
    });

    for (const record of records) {
      if (record.definition.target.type !== "execution_graph") {
        continue;
      }

      const graphId = record.definition.target.graphId ?? record.definition.id;
      const taskId = record.definition.target.taskId ?? getTaskIdForGraphId(graphId);
      if (!taskId) {
        continue;
      }
      const graph = getGraph(taskId);
      if (!graph?.schedule) {
        continue;
      }

      defaultGraphStore.updateGraphStructure(
        graph.id,
        {
          mode: graph.mode,
          nodes: graph.nodes,
          edges: graph.edges,
          policy: graph.policy,
          doneCriteria: graph.doneCriteria,
          schedule: {
            ...graph.schedule,
            state: "stopped",
            tickInProgress: false,
            currentConcurrency: 0,
          },
        },
        graph.graphVersion,
      );
      changes += 1;
    }

    if (changes > 0 || !isAutomationDualReadEnabled()) {
      return changes;
    }
  }

  const db = getSQLiteDb();
  const result = db
    .prepare(
      `UPDATE execution_graphs
       SET schedule = json_set(schedule, '$.state', 'stopped', '$.tickInProgress', json('false'), '$.currentConcurrency', 0),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE schedule IS NOT NULL
         AND json_extract(schedule, '$.rootMessageId') = ?
         AND json_extract(schedule, '$.state') = 'active'`,
    )
    .run(normalized);

  return Number(result.changes ?? 0);
}
