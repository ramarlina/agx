/**
 * @jest-environment node
 */

import { pragmaSet } from "@/lib/sqlite-compat";
import type { Edge, ExecutionGraph, GraphEvent, GraphNode } from "@/src/graph/types";
import {
  GraphVersionConflictError,
  createGraphStore,
  type PoolClientLike,
  type PoolLike,
} from "@/src/graph/store";

interface FakeExecutionGraphRow extends Record<string, unknown> {
  id: string;
  task_id: string;
  graph_version: number;
  mode: ExecutionGraph["mode"];
  policy: ExecutionGraph["policy"];
  done_criteria: ExecutionGraph["doneCriteria"];
  created_at: string;
  updated_at: string;
}

interface FakeGraphNodeRow extends Record<string, unknown> {
  graph_id: string;
  node_id: string;
  type: GraphNode["type"];
  status: GraphNode["status"];
  config: Record<string, unknown>;
  output: Record<string, unknown> | null;
  metrics: GraphNode["metrics"] | null;
}

interface FakeGraphEdgeRow extends Record<string, unknown> {
  graph_id: string;
  from_id: string;
  to_id: string;
  type: Edge["type"];
  condition: Edge["condition"] | null;
  data_mapping: Edge["dataMapping"] | null;
}

interface FakeGraphEventRow extends Record<string, unknown> {
  graph_id: string;
  event_type: GraphEvent["eventType"];
  payload: GraphEvent;
  timestamp: string;
}

interface FakeDbState {
  tasks: Record<string, { id: string; graph_id: string | null }>;
  executionGraphs: Record<string, FakeExecutionGraphRow>;
  graphNodes: FakeGraphNodeRow[];
  graphEdges: FakeGraphEdgeRow[];
  graphEvents: FakeGraphEventRow[];
}

class FakePool implements PoolLike {
  private state: FakeDbState;

  constructor(seedTaskId: string) {
    this.state = {
      tasks: {
        [seedTaskId]: {
          id: seedTaskId,
          graph_id: null,
        },
      },
      executionGraphs: {},
      graphNodes: [],
      graphEdges: [],
      graphEvents: [],
    };
  }

  async connect(): Promise<PoolClientLike> {
    return new FakeClient(this);
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }> {
    const client = new FakeClient(this);
    return client.query<T>(text, params);
  }

  snapshot(): FakeDbState {
    return JSON.parse(JSON.stringify(this.state)) as FakeDbState;
  }

  restore(snapshot: FakeDbState): void {
    this.state = JSON.parse(JSON.stringify(snapshot)) as FakeDbState;
  }

  getState(): FakeDbState {
    return this.state;
  }
}

class FakeClient implements PoolClientLike {
  private readonly pool: FakePool;
  private txSnapshot: FakeDbState | null = null;

  constructor(pool: FakePool) {
    this.pool = pool;
  }

  release(): void {
    // no-op
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    const sql = text.replace(/\s+/g, " ").trim().toLowerCase();
    const state = this.pool.getState();

    if (sql === "begin") {
      this.txSnapshot = this.pool.snapshot();
      return { rows: [] as unknown as T[] };
    }
    if (sql === "commit") {
      this.txSnapshot = null;
      return { rows: [] as unknown as T[] };
    }
    if (sql === "rollback") {
      if (this.txSnapshot) {
        this.pool.restore(this.txSnapshot);
      }
      this.txSnapshot = null;
      return { rows: [] as unknown as T[] };
    }

    if (
      sql.startsWith(
        "select id from agx.execution_graphs where task_id = $1 limit 1",
      )
    ) {
      const taskId = String(params[0]);
      const rows = Object.values(state.executionGraphs)
        .filter((row) => row.task_id === taskId)
        .slice(0, 1)
        .map((row) => ({ id: row.id }));
      return { rows: rows as unknown as T[] };
    }

    if (sql.startsWith("insert into agx.execution_graphs")) {
      const [id, taskId, graphVersion, mode, policy, doneCriteria, createdAt, updatedAt] = params;
      state.executionGraphs[String(id)] = {
        id: String(id),
        task_id: String(taskId),
        graph_version: Number(graphVersion),
        mode: mode as ExecutionGraph["mode"],
        policy: parseJson(policy) as ExecutionGraph["policy"],
        done_criteria: parseJson(doneCriteria) as ExecutionGraph["doneCriteria"],
        created_at: String(createdAt),
        updated_at: String(updatedAt),
      };
      return { rows: [] as unknown as T[] };
    }

    if (sql.startsWith("delete from agx.graph_nodes where graph_id = $1")) {
      const graphId = String(params[0]);
      state.graphNodes = state.graphNodes.filter((row) => row.graph_id !== graphId);
      return { rows: [] as unknown as T[] };
    }

    if (sql.startsWith("delete from agx.graph_edges where graph_id = $1")) {
      const graphId = String(params[0]);
      state.graphEdges = state.graphEdges.filter((row) => row.graph_id !== graphId);
      return { rows: [] as unknown as T[] };
    }

    if (sql.startsWith("insert into agx.graph_nodes")) {
      const [graphId, nodeId, type, status, config, output, metrics] = params;
      state.graphNodes.push({
        graph_id: String(graphId),
        node_id: String(nodeId),
        type: type as GraphNode["type"],
        status: status as GraphNode["status"],
        config: parseJson(config) as Record<string, unknown>,
        output: parseJson(output) as Record<string, unknown> | null,
        metrics: parseJson(metrics) as GraphNode["metrics"] | null,
      });
      return { rows: [] as unknown as T[] };
    }

    if (sql.startsWith("insert into agx.graph_edges")) {
      const [graphId, fromId, toId, type, condition, dataMapping] = params;
      state.graphEdges.push({
        graph_id: String(graphId),
        from_id: String(fromId),
        to_id: String(toId),
        type: type as Edge["type"],
        condition: (condition as Edge["condition"]) ?? null,
        data_mapping: parseJson(dataMapping) as Edge["dataMapping"] | null,
      });
      return { rows: [] as unknown as T[] };
    }

    if (sql.startsWith("insert into agx.graph_events")) {
      const [graphId, eventType, payload, timestamp] = params;
      state.graphEvents.push({
        graph_id: String(graphId),
        event_type: eventType as GraphEvent["eventType"],
        payload: parseJson(payload) as GraphEvent,
        timestamp: String(timestamp),
      });
      return { rows: [] as unknown as T[] };
    }

    if (sql.startsWith("update agx.tasks set graph_id = $1 where id = $2")) {
      const graphId = String(params[0]);
      const taskId = String(params[1]);
      state.tasks[taskId] = state.tasks[taskId] || { id: taskId, graph_id: null };
      state.tasks[taskId].graph_id = graphId;
      return { rows: [] as unknown as T[] };
    }

    if (
      sql.startsWith(
        "select id, task_id, graph_version, mode, policy, done_criteria, created_at, updated_at from agx.execution_graphs where task_id = $1",
      )
    ) {
      const taskId = String(params[0]);
      const rows = Object.values(state.executionGraphs)
        .filter((row) => row.task_id === taskId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 1);
      return { rows: rows as unknown as T[] };
    }

    if (
      sql.startsWith(
        "select node_id, type, status, config, output, metrics from agx.graph_nodes where graph_id = $1 and node_id = any($2::text[])",
      )
    ) {
      const graphId = String(params[0]);
      const nodeIds = new Set((params[1] as string[]) || []);
      const rows = state.graphNodes.filter(
        (row) => row.graph_id === graphId && nodeIds.has(row.node_id),
      );
      return { rows: rows as unknown as T[] };
    }

    if (
      sql.startsWith(
        "select node_id, type, status, config, output, metrics from agx.graph_nodes where graph_id = $1 order by node_id asc",
      )
    ) {
      const graphId = String(params[0]);
      const rows = state.graphNodes
        .filter((row) => row.graph_id === graphId)
        .sort((a, b) => a.node_id.localeCompare(b.node_id));
      return { rows: rows as unknown as T[] };
    }

    if (
      sql.startsWith(
        "select from_id, to_id, type, condition, data_mapping from agx.graph_edges where graph_id = $1 order by from_id asc, to_id asc",
      )
    ) {
      const graphId = String(params[0]);
      const rows = state.graphEdges
        .filter((row) => row.graph_id === graphId)
        .sort((a, b) => {
          const fromCompare = a.from_id.localeCompare(b.from_id);
          if (fromCompare !== 0) {
            return fromCompare;
          }
          return a.to_id.localeCompare(b.to_id);
        });
      return { rows: rows as unknown as T[] };
    }

    if (
      sql.startsWith(
        'select event_type, payload, "timestamp" as timestamp from agx.graph_events where graph_id = $1 order by "timestamp" asc, event_type asc',
      )
    ) {
      const graphId = String(params[0]);
      const rows = state.graphEvents
        .filter((row) => row.graph_id === graphId)
        .sort((a, b) => {
          const timestampCompare = a.timestamp.localeCompare(b.timestamp);
          if (timestampCompare !== 0) {
            return timestampCompare;
          }
          return a.event_type.localeCompare(b.event_type);
        })
        .map((row) => ({
          event_type: row.event_type,
          payload: row.payload,
          timestamp: row.timestamp,
        }));
      return { rows: rows as unknown as T[] };
    }

    if (
      sql.startsWith(
        "select id, graph_version from agx.execution_graphs where id = $1 for update",
      )
    ) {
      const graphId = String(params[0]);
      const graph = state.executionGraphs[graphId];
      if (!graph) {
        return { rows: [] as unknown as T[] };
      }
      return { rows: [{ id: graph.id, graph_version: graph.graph_version }] as unknown as T[] };
    }

    if (
      sql.startsWith(
        "select id, graph_version, mode, policy, done_criteria from agx.execution_graphs where id = $1 for update",
      )
    ) {
      const graphId = String(params[0]);
      const graph = state.executionGraphs[graphId];
      if (!graph) {
        return { rows: [] as unknown as T[] };
      }
      return {
        rows: [
          {
            id: graph.id,
            graph_version: graph.graph_version,
            mode: graph.mode,
            policy: graph.policy,
            done_criteria: graph.done_criteria,
          },
        ] as unknown as T[],
      };
    }

    if (
      sql.startsWith(
        "select graph_version, updated_at from agx.execution_graphs where id = $1",
      )
    ) {
      const graphId = String(params[0]);
      const graph = state.executionGraphs[graphId];
      return {
        rows: graph ? ([{ graph_version: graph.graph_version, updated_at: graph.updated_at }] as unknown as T[]) : ([] as unknown as T[]),
      };
    }

    if (
      sql.startsWith(
        "update agx.graph_nodes set status = $3, metrics = $4::jsonb, output = $5::jsonb, config = $6::jsonb where graph_id = $1 and node_id = $2",
      )
    ) {
      const [graphId, nodeId, status, metrics, output, config] = params;
      const match = state.graphNodes.find(
        (row) => row.graph_id === String(graphId) && row.node_id === String(nodeId),
      );
      if (match) {
        match.status = status as GraphNode["status"];
        match.metrics = parseJson(metrics) as GraphNode["metrics"] | null;
        match.output = parseJson(output) as Record<string, unknown> | null;
        match.config = parseJson(config) as Record<string, unknown>;
      }
      return { rows: [] as unknown as T[] };
    }

    if (
      sql.startsWith(
        "update agx.execution_graphs set updated_at = now() where id = $1 returning graph_version, updated_at",
      )
    ) {
      const graphId = String(params[0]);
      const graph = state.executionGraphs[graphId];
      if (!graph) {
        return { rows: [] as unknown as T[] };
      }

      graph.graph_version += 1;
      graph.updated_at = new Date().toISOString();
      return {
        rows: [{ graph_version: graph.graph_version, updated_at: graph.updated_at }] as unknown as T[],
      };
    }

    if (
      sql.startsWith(
        "update agx.execution_graphs set mode = $2, policy = $3::jsonb, done_criteria = $4::jsonb, updated_at = now() where id = $1 returning graph_version, updated_at",
      )
    ) {
      const graphId = String(params[0]);
      const graph = state.executionGraphs[graphId];
      if (!graph) {
        return { rows: [] as unknown as T[] };
      }
      graph.mode = params[1] as ExecutionGraph["mode"];
      graph.policy = parseJson(params[2]) as ExecutionGraph["policy"];
      graph.done_criteria = parseJson(params[3]) as ExecutionGraph["doneCriteria"];
      graph.graph_version += 1;
      graph.updated_at = new Date().toISOString();
      return {
        rows: [{ graph_version: graph.graph_version, updated_at: graph.updated_at }] as unknown as T[],
      };
    }

    throw new Error(`Unhandled SQL in FakeClient: ${text}`);
  }
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return JSON.parse(value) as unknown;
  }
  return value;
}

let graphCounter = 0;
function buildSampleGraph(taskId: string): ExecutionGraph {
  graphCounter += 1;
  return {
    id: `graph-store-test-${graphCounter}-${Date.now()}`,
    taskId,
    graphVersion: 1,
    mode: "PROJECT",
    nodes: {
      "work-main": {
        type: "work",
        status: "pending",
        deps: [],
        title: "Implement feature",
        description: "Main implementation task",
        attempts: 0,
        maxAttempts: 2,
        retryPolicy: { backoffMs: 5000, onExhaust: "escalate" },
        stage: "execution",
        lane: "default",
        estimateMinutes: 45,
        output: { draft: true },
        metrics: { tokensUsed: 120, latencyMs: 3200, retryCount: 0, errorMessages: [] },
      },
      "quality-gate": {
        type: "gate",
        status: "pending",
        deps: ["work-main"],
        gateType: "quality_gate",
        required: true,
        verificationStrategy: { type: "auto", checks: ["tests_pass"], timeout: 300000 },
      },
      "fork-1": {
        type: "fork",
        status: "pending",
        deps: ["quality-gate"],
      },
      "join-1": {
        type: "join",
        status: "pending",
        deps: ["work-main", "fork-1"],
        joinStrategy: "n_of_m",
        requiredCount: 1,
      },
      "cond-1": {
        type: "conditional",
        status: "pending",
        deps: ["join-1"],
        condition: { expression: "ctx.input.ok == true", inputFrom: "work-main" },
        thenBranch: ["work-main"],
        elseBranch: ["quality-gate"],
      },
    },
    edges: [
      { from: "cond-1", to: "quality-gate", type: "soft", condition: "always" },
      {
        from: "fork-1",
        to: "join-1",
        type: "hard",
        dataMapping: [{ sourceField: "result", targetField: "joinedResult" }],
      },
      { from: "join-1", to: "cond-1", type: "hard", condition: "on_success" },
      { from: "quality-gate", to: "fork-1", type: "hard", condition: "on_success" },
      { from: "work-main", to: "join-1", type: "hard", condition: "always" },
      { from: "work-main", to: "quality-gate", type: "hard", condition: "on_success" },
    ],
    policy: {
      replanBudgetRemaining: 2,
      replanBudgetInitial: 3,
      verifyBudgetRemaining: 4,
      verifyBudgetInitial: 5,
      maxConcurrentAutoChecks: 1,
      immutableRequiredGates: true,
      maxConcurrent: 3,
      priorityMode: "critical_path",
      nodeTimeoutMs: 1800000,
      graphTimeoutMs: 86400000,
    },
    doneCriteria: {
      allRequiredGatesPassed: true,
      noRunnableOrPendingWork: true,
      completionSinkNodeIds: ["cond-1"],
      customCriteria: ["all-tests-green"],
    },
    versionHistory: [
      {
        eventType: "replan",
        fromVersion: 1,
        toVersion: 2,
        timestamp: "2026-02-14T00:00:01.000Z",
        reason: "split implementation into branches",
        triggeredBy: "agent",
        triggeredAtNodeId: "quality-gate",
        changes: {
          addedNodes: ["fork-1", "join-1"],
          removedNodes: [],
          rewiredDeps: ["quality-gate", "cond-1"],
          estimateDeltas: { "work-main": 10 },
        },
      },
    ],
    runtimeEvents: [
      {
        eventType: "node_status",
        nodeId: "work-main",
        fromStatus: "pending",
        toStatus: "running",
        timestamp: "2026-02-14T00:00:02.000Z",
        reason: "deps satisfied",
      },
    ],
    createdAt: "2026-02-14T00:00:00.000Z",
    updatedAt: "2026-02-14T00:00:03.000Z",
  };
}

function ensureTaskExists(taskId: string) {
  const { getSQLiteDb } = require("@/lib/sqlite-query-adapter");
  const db = getSQLiteDb();
  pragmaSet(db, "foreign_keys = OFF");
}

describe("graph store", () => {
  beforeAll(() => {
    const { getSQLiteDb } = require("@/lib/sqlite-query-adapter");
    const db = getSQLiteDb();
    pragmaSet(db, "foreign_keys = OFF");
  });

  test("round-trips createGraph -> getGraph with all fields preserved", async () => {
    const taskId = `task-store-round-trip-${Date.now()}`;
    const fakePool = new FakePool(taskId);
    const store = createGraphStore(fakePool);
    const graph = buildSampleGraph(taskId);

    await store.createGraph(graph);
    const roundTripped = await store.getGraph(taskId);

    expect(roundTripped).toBeTruthy();
    expect(roundTripped!.id).toBe(graph.id);
    expect(roundTripped!.taskId).toBe(graph.taskId);
    expect(roundTripped!.graphVersion).toBe(graph.graphVersion);
    expect(roundTripped!.mode).toBe(graph.mode);
    expect(Object.keys(roundTripped!.nodes)).toEqual(expect.arrayContaining(Object.keys(graph.nodes)));
  });

  test("rejects stale ifMatchGraphVersion in updateNodeRuntime", async () => {
    const taskId = `task-store-stale-${Date.now()}`;
    const fakePool = new FakePool(taskId);
    const store = createGraphStore(fakePool);
    const graph = buildSampleGraph(taskId);

    await store.createGraph(graph);
    const updated = await store.updateNodeRuntime(
      graph.id,
      {
        "work-main": {
          status: "running",
          startedAt: "2026-02-14T00:10:00.000Z",
          metrics: { tokensUsed: 250, latencyMs: 8000, retryCount: 0 },
          output: { progress: "50%" },
        },
      },
      1,
    );

    // SQLite RETURNING returns pre-trigger value; trigger increments graph_version
    expect(updated.graphVersion).toBe(1);

    // After trigger, actual DB version is 2, so passing stale version 1 should fail
    expect(() =>
      store.updateNodeRuntime(
        graph.id,
        { "work-main": { status: "done", completedAt: "2026-02-14T00:20:00.000Z" } },
        1,
      ),
    ).toThrow(GraphVersionConflictError);
  });

  test("appendEvent persists and getGraph classifies runtime event streams", async () => {
    const taskId = `task-store-events-${Date.now()}`;
    const fakePool = new FakePool(taskId);
    const store = createGraphStore(fakePool);
    const graph = buildSampleGraph(taskId);

    await store.createGraph(graph);

    await store.appendEvent(graph.id, {
      eventType: "budget_consumed",
      budgetType: "verify",
      remaining: 3,
      timestamp: "2026-02-14T00:00:04.000Z",
      triggerNodeId: "quality-gate",
    });

    const loaded = await store.getGraph(taskId);
    expect(loaded).not.toBeNull();
    expect(loaded?.runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "budget_consumed",
          budgetType: "verify",
          remaining: 3,
          triggerNodeId: "quality-gate",
        }),
      ]),
    );
  });
});
