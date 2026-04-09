/**
 * @jest-environment node
 */

import {
  migrateTaskToV2,
  type V1Task,
} from "@/src/graph/migrate";
import {
  computeParityDiff,
  projectLegacyCompatFromGraph,
} from "@/src/graph/parity";

function buildLegacyTask(overrides: Partial<V1Task> = {}): V1Task {
  return {
    id: "task-migration-int",
    title: "Migration integration",
    status: "in_progress",
    checkpoints: [
      {
        id: "cp-1",
        description: "Design",
        completed: true,
        createdAt: "2026-02-10T09:00:00.000Z",
        completedAt: "2026-02-10T09:20:00.000Z",
      },
      {
        id: "cp-2",
        description: "Implement",
        completed: false,
        createdAt: "2026-02-10T10:00:00.000Z",
      },
    ],
    createdAt: "2026-02-10T08:00:00.000Z",
    updatedAt: "2026-02-10T10:10:00.000Z",
    startedAt: "2026-02-10T08:05:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("migration integration", () => {
  test("idempotent migration output: running migration twice yields the same graph", () => {
    const legacy = buildLegacyTask();
    const opts = { graphId: `graph-${legacy.id}-v2` };

    const first = migrateTaskToV2(legacy, opts);
    const second = migrateTaskToV2(legacy, opts);

    expect(first).toEqual(second);
    expect(first.id).toBe(`graph-${legacy.id}-v2`);
  });

  test("dual-write parity: migrated v2 projection matches legacy task fields", () => {
    const legacy = buildLegacyTask({
      status: "completed",
      completedAt: "2026-02-10T11:00:00.000Z",
    });

    const graph = migrateTaskToV2(legacy);
    const v2Projection = projectLegacyCompatFromGraph(graph, "execution");

    const parityDiff = computeParityDiff({
      taskId: legacy.id,
      source: "dual_write_integration",
      legacy: {
        status: "completed",
        stage: "done",
        progressPercent: 100,
      },
      v2: v2Projection,
    });

    expect(parityDiff).toBeNull();
  });

  test("backfill preserves task timestamps and deterministic history defaults", () => {
    const legacy = buildLegacyTask({
      status: "completed",
      completedAt: "2026-02-10T11:00:00.000Z",
      updatedAt: "2026-02-10T11:01:00.000Z",
    });

    const graph = migrateTaskToV2(legacy);

    expect(graph.createdAt).toBe("2026-02-10T08:00:00.000Z");
    expect(graph.updatedAt).toBe("2026-02-10T11:01:00.000Z");
    expect(graph.versionHistory).toEqual([]);

    const handoff = graph.nodes["handoff-gate"];
    expect(handoff.type).toBe("gate");
    if (handoff.type === "gate") {
      expect(handoff.status).toBe("passed");
      expect(handoff.completedAt).toBe("2026-02-10T11:00:00.000Z");
    }
  });

  test.todo("cleanup gate placeholder: scan repo for executable v1 workflow/stage code paths");
});
