import type { Task } from "@/lib/db-adapter.interface";
import { isDualWriteEnabled } from "@/src/graph/feature-flags";
import { createRootOnlyGraph } from "@/src/graph/migrate";
import { logParityDiff } from "@/src/graph/parity";
import {
  createGraph,
  getGraph,
  GraphTaskAlreadyBoundError,
} from "@/src/graph/store";
import { validateGraph } from "@/src/graph/validate";

export interface DualWriteResult {
  enabled: boolean;
  result: "disabled" | "created" | "existing" | "failed";
  graphId?: string;
  error?: string;
}

export async function dualWriteTaskCreation(task: Task): Promise<DualWriteResult> {
  if (!isDualWriteEnabled()) {
    return { enabled: false, result: "disabled" };
  }

  try {
    const existing = await getGraph(task.id);
    if (existing) {
      logParityDiff({ source: "task_create_dual_write", task, graph: existing });
      return {
        enabled: true,
        result: "existing",
        graphId: existing.id,
      };
    }

    const graph = createRootOnlyGraph({
      id: task.id,
      title: task.title || undefined,
      description: task.description || undefined,
      content: task.content || undefined,
    });
    const validation = validateGraph(graph);
    if (!validation.valid) {
      return {
        enabled: true,
        result: "failed",
        error: `validateGraph failed: ${JSON.stringify(validation.errors)}`,
      };
    }

    const persisted = await createGraph(graph);
    logParityDiff({ source: "task_create_dual_write", task, graph: persisted });

    return {
      enabled: true,
      result: "created",
      graphId: persisted.id,
    };
  } catch (error) {
    if (error instanceof GraphTaskAlreadyBoundError) {
      const existing = await getGraph(task.id);
      if (existing) {
        logParityDiff({ source: "task_create_dual_write", task, graph: existing });
      }
      return {
        enabled: true,
        result: "existing",
        graphId: error.existingGraphId,
      };
    }

    return {
      enabled: true,
      result: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
