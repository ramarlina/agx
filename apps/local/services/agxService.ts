import type { AgxProject, AgxTask, BuildResult, TaskDraft } from "@/types/tasks";

const AGX_BOARD_URL = process.env.NEXT_PUBLIC_AGX_BOARD_URL || "http://localhost:41741";

export async function listProjects(): Promise<AgxProject[]> {
  const res = await fetch(`${AGX_BOARD_URL}/api/projects`);
  if (!res.ok) {
    if (res.status === 503) throw new Error("SCHEMA_NOT_READY");
    throw new Error(`Failed to list projects: ${res.status}`);
  }
  const data = await res.json();
  return data.projects ?? data;
}

export async function createProject(name: string, description?: string): Promise<AgxProject> {
  const res = await fetch(`${AGX_BOARD_URL}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) throw new Error(`Failed to create project: ${res.status}`);
  return res.json();
}

export async function createTask(
  content: string,
  opts?: { title?: string; project_id?: string; depends_on?: string[] },
): Promise<AgxTask> {
  const res = await fetch(`${AGX_BOARD_URL}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, ...opts }),
  });
  if (!res.ok) throw new Error(`Failed to create task: ${res.status}`);
  const data = await res.json();
  const task = data.task ?? data;
  // API returns id at top level
  if (data.id && !task.id) task.id = data.id;
  return task;
}

export async function getTask(taskId: string): Promise<AgxTask | null> {
  const res = await fetch(`${AGX_BOARD_URL}/api/tasks/${taskId}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.task ?? data;
}

export async function assignTaskToProject(taskId: string, projectId: string): Promise<void> {
  const res = await fetch(`${AGX_BOARD_URL}/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId }),
  });
  if (!res.ok) throw new Error(`Failed to assign task: ${res.status}`);
}

export async function getProjectTasks(projectId: string): Promise<AgxTask[]> {
  const res = await fetch(`${AGX_BOARD_URL}/api/tasks?project=${projectId}`);
  if (!res.ok) throw new Error(`Failed to get tasks: ${res.status}`);
  const data = await res.json();
  return data.tasks ?? data;
}

function topoSort(tasks: TaskDraft[]): TaskDraft[] {
  const idSet = new Set(tasks.map((t) => t.id));
  const adjMap = new Map<string, string[]>(); // id → deps within this set
  for (const t of tasks) {
    adjMap.set(t.id, (t.dependsOn || []).filter((d) => idSet.has(d)));
  }

  const sorted: TaskDraft[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) return; // cycle — break it
    visiting.add(id);
    for (const dep of adjMap.get(id) || []) {
      visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
    sorted.push(tasks.find((t) => t.id === id)!);
  }

  for (const t of tasks) visit(t.id);
  return sorted;
}

export async function buildTasks(
  tasks: TaskDraft[],
  projectId: string,
  buildId: string,
  existingMapping?: Record<string, string>,
): Promise<BuildResult> {
  const results: BuildResult["results"] = [];

  // Track client draft ID → remote task ID as we create them
  const localToRemote: Record<string, string> = { ...existingMapping };

  // Topological sort then push in parallel layers
  const ordered = topoSort(tasks);
  const remaining = new Map(ordered.map((t) => [t.id, t]));

  while (remaining.size > 0) {
    // Find tasks whose deps are all resolved
    const layer: TaskDraft[] = [];
    for (const task of remaining.values()) {
      const depsResolved = (task.dependsOn || []).every(
        (depId) => !remaining.has(depId) || localToRemote[depId]
      );
      if (depsResolved) layer.push(task);
    }
    // Safety: if nothing is ready, push whatever remains (broken deps)
    if (layer.length === 0) {
      layer.push(...remaining.values());
    }

    const settled = await Promise.allSettled(
      layer.map(async (task) => {
        // Idempotent: skip tasks already pushed
        const existingRemoteId = localToRemote[task.id];
        if (existingRemoteId) {
          const existing = await getTask(existingRemoteId);
          if (existing) return { task, remoteId: existingRemoteId };
        }

        const remoteDeps = (task.dependsOn || [])
          .map((depId) => localToRemote[depId])
          .filter(Boolean);

        const created = await createTask(task.description, {
          title: task.title,
          project_id: projectId,
          depends_on: remoteDeps.length > 0 ? remoteDeps : undefined,
        });
        return { task, remoteId: created.id };
      })
    );

    for (const result of settled) {
      if (result.status === "fulfilled") {
        const { task, remoteId } = result.value;
        localToRemote[task.id] = remoteId;
        results.push({ clientTaskId: task.id, remoteTaskId: remoteId, status: "created" });
        remaining.delete(task.id);
      } else {
        // Find which task failed (match by order)
        const idx = settled.indexOf(result);
        const task = layer[idx];
        results.push({
          clientTaskId: task.id,
          status: "failed",
          error: result.reason instanceof Error ? result.reason.message : "Unknown error",
        });
        remaining.delete(task.id);
      }
    }
  }

  return { buildId, projectId, results };
}
