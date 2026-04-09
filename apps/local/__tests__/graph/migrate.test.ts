/**
 * @jest-environment node
 */

import { migrateTaskToV2, type V1Task } from "@/src/graph/migrate";
import { validateGraph } from "@/src/graph/validate";

function buildLegacyTask(overrides: Partial<V1Task> = {}): V1Task {
  return {
    id: "task-migrate-1",
    title: "Legacy migration task",
    status: "in_progress",
    checkpoints: [
      {
        id: "cp-1",
        description: "Design approach",
        completed: true,
        createdAt: "2026-02-10T10:00:00.000Z",
        completedAt: "2026-02-10T10:15:00.000Z",
      },
      {
        id: "cp-2",
        description: "Implement code",
        completed: false,
        createdAt: "2026-02-10T11:00:00.000Z",
      },
    ],
    createdAt: "2026-02-10T09:00:00.000Z",
    updatedAt: "2026-02-10T11:05:00.000Z",
    startedAt: "2026-02-10T09:05:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("migrateTaskToV2", () => {
  test("is idempotent for the same v1 input (with fixed graphId)", () => {
    const v1Task = buildLegacyTask();
    const opts = { graphId: `graph-${v1Task.id}-v2` };

    const first = migrateTaskToV2(v1Task, opts);
    const second = migrateTaskToV2(v1Task, opts);

    expect(first).toEqual(second);
    expect(first.id).toBe(`graph-${v1Task.id}-v2`);
  });

  test("creates work + progress gates + required human handoff gate", () => {
    const graph = migrateTaskToV2(buildLegacyTask());

    const nodeIds = Object.keys(graph.nodes);
    expect(nodeIds.length).toBe(6);
    expect(graph.nodes["root"]).toBeDefined();
    expect(graph.nodes["root"].type).toBe("root");
    expect(nodeIds.some((id) => id.startsWith("work-"))).toBe(true);
    expect(nodeIds.some((id) => id.startsWith("gate-"))).toBe(true);
    expect(graph.nodes["handoff-gate"]).toBeDefined();
    expect(graph.nodes["handoff-gate"].type).toBe("gate");
    if (graph.nodes["handoff-gate"].type === "gate") {
      expect(graph.nodes["handoff-gate"].required).toBe(true);
      expect(graph.nodes["handoff-gate"].verificationStrategy.type).toBe("human");
    }

    expect(graph.policy.replanBudgetInitial).toBe(3);
    expect(graph.policy.verifyBudgetInitial).toBe(5);
    expect(graph.policy.maxConcurrent).toBe(1);
    expect(graph.policy.priorityMode).toBe("fifo");
    expect(graph.createdAt).toBe("2026-02-10T09:00:00.000Z");
    expect(graph.updatedAt).toBe("2026-02-10T11:05:00.000Z");
  });

  test("maps completed legacy tasks to terminal node states", () => {
    const graph = migrateTaskToV2(
      buildLegacyTask({
        status: "completed",
        completedAt: "2026-02-10T12:00:00.000Z",
      }),
    );

    for (const node of Object.values(graph.nodes)) {
      if (node.type === "work") {
        expect(node.status).toBe("done");
      }
      if (node.type === "gate") {
        expect(node.status).toBe("passed");
      }
    }
  });

  test("produces graphs that pass validateGraph", () => {
    const graph = migrateTaskToV2(buildLegacyTask());
    const validation = validateGraph(graph);

    expect(validation.valid).toBe(true);
    expect(validation.errors.dag).toEqual([]);
    expect(validation.errors.depsEdgesConsistency).toEqual([]);
  });
});
