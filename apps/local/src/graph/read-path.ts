import type { Task } from "@/lib/db-adapter.interface";
import { parseFrontmatter } from "@/lib/db";
import { isV2ReadPathEnabled } from "@/src/graph/feature-flags";
import { logParityDiff, projectLegacyCompatFromGraph } from "@/src/graph/parity";
import { getGraph } from "@/src/graph/store";

export interface TaskReadProjection extends Task {
  read_path_source?: "v1" | "v2";
}

function normalizeDependsOn(input: unknown): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return Array.from(new Set(input.map((entry) => String(entry || "").trim()).filter(Boolean)));
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return Array.from(new Set(parsed.map((entry) => String(entry || "").trim()).filter(Boolean)));
      }
    } catch {
      // Fallback to comma-separated.
    }
    return Array.from(new Set(trimmed.split(",").map((entry) => entry.trim()).filter(Boolean)));
  }
  return [];
}

function withDependsOnFallback(task: Task): TaskReadProjection {
  const direct = normalizeDependsOn((task as any).depends_on);
  if (direct.length || typeof task?.content !== "string") {
    return task as TaskReadProjection;
  }
  const { frontmatter } = parseFrontmatter(task.content || "");
  const fromFrontmatter = normalizeDependsOn(frontmatter.depends_on);
  if (!fromFrontmatter.length) {
    return task as TaskReadProjection;
  }
  return {
    ...(task as TaskReadProjection),
    depends_on: fromFrontmatter,
  };
}

function inferBlockedReason(task: Task): string | null | undefined {
  if (
    task.status === "blocked" &&
    !task.blocked_reason &&
    (!task.stage || task.stage.toLowerCase() === "intake")
  ) {
    return "Awaiting approval";
  }
  return task.blocked_reason;
}

export async function projectTaskReadModel(task: Task): Promise<TaskReadProjection> {
  if (!isV2ReadPathEnabled()) {
    return { ...withDependsOnFallback(task), blocked_reason: inferBlockedReason(task), read_path_source: "v1" };
  }

  try {
    const graph = await getGraph(task.id);
    if (!graph) {
      return { ...withDependsOnFallback(task), read_path_source: "v1" };
    }

    const projection = projectLegacyCompatFromGraph(graph, (task.stage as any) || "INTAKE");
    const status =
      projection.status === "queued" && task.status && task.status !== "queued"
        ? task.status
        : projection.status;
    const stage = status === "completed" ? "DONE" : projection.stage;

    logParityDiff({
      source: "read_path",
      task,
      graph,
    });

    const projected = { ...withDependsOnFallback(task), status, stage };
    return {
      ...projected,
      blocked_reason: inferBlockedReason(projected),
      read_path_source: "v2",
    };
  } catch (error) {
    console.error("Failed to project task from v2 graph; using v1 compatibility mode", error);
    return { ...withDependsOnFallback(task), read_path_source: "v1" };
  }
}

export async function projectTaskReadModels(tasks: Task[]): Promise<TaskReadProjection[]> {
  return Promise.all(tasks.map((task) => projectTaskReadModel(task)));
}
