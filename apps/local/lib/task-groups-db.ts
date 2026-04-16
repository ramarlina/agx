import type { DatabaseSync } from "node:sqlite";

export interface TaskGroup {
  id: string;
  project_id: string;
  name: string;
  position: number;
  collapsed: number;
  created_at: string;
  updated_at: string;
}

export interface TaskGroupWithTaskIds extends TaskGroup {
  task_ids: string[];
}

export function createTaskGroup(
  db: DatabaseSync,
  opts: { projectId: string; name: string; taskIds?: string[] },
): TaskGroup {
  const id = generateId();
  const { projectId, name, taskIds = [] } = opts;

  const maxPos = db
    .prepare("SELECT COALESCE(MAX(position), -1) AS max_pos FROM task_groups WHERE project_id = ?")
    .get(projectId) as { max_pos: number };

  db.prepare(
    "INSERT INTO task_groups (id, project_id, name, position) VALUES (?, ?, ?, ?)",
  ).run(id, projectId, name, maxPos.max_pos + 1);

  if (taskIds.length > 0) {
    const stmt = db.prepare(
      "UPDATE tasks SET group_id = ?, group_position = ? WHERE id = ?",
    );
    taskIds.forEach((taskId, idx) => {
      stmt.run(id, idx, taskId);
    });
  }

  return db.prepare("SELECT * FROM task_groups WHERE id = ?").get(id) as unknown as TaskGroup;
}

export function listTaskGroups(
  db: DatabaseSync,
  projectId: string,
): TaskGroupWithTaskIds[] {
  const groups = db
    .prepare("SELECT * FROM task_groups WHERE project_id = ? ORDER BY position ASC")
    .all(projectId) as unknown as TaskGroup[];

  return groups.map((group) => {
    const tasks = db
      .prepare("SELECT id FROM tasks WHERE group_id = ? ORDER BY group_position ASC")
      .all(group.id) as unknown as { id: string }[];
    return { ...group, task_ids: tasks.map((t) => t.id) };
  });
}

export function updateTaskGroup(
  db: DatabaseSync,
  groupId: string,
  updates: Partial<Pick<TaskGroup, "name" | "position" | "collapsed">>,
): TaskGroup {
  const setClauses: string[] = [];
  const values: (string | number)[] = [];

  if (updates.name !== undefined) {
    setClauses.push("name = ?");
    values.push(updates.name);
  }
  if (updates.position !== undefined) {
    setClauses.push("position = ?");
    values.push(updates.position);
  }
  if (updates.collapsed !== undefined) {
    setClauses.push("collapsed = ?");
    values.push(updates.collapsed);
  }

  if (setClauses.length > 0) {
    values.push(groupId);
    db.prepare(`UPDATE task_groups SET ${setClauses.join(", ")} WHERE id = ?`).run(
      ...values,
    );
  }

  return db.prepare("SELECT * FROM task_groups WHERE id = ?").get(groupId) as unknown as TaskGroup;
}

export function deleteTaskGroup(db: DatabaseSync, groupId: string): void {
  db.prepare("UPDATE tasks SET group_position = 0 WHERE group_id = ?").run(groupId);
  db.prepare("DELETE FROM task_groups WHERE id = ?").run(groupId);
}

export function assignTasksToGroup(
  db: DatabaseSync,
  groupId: string,
  taskIds: string[],
): void {
  const maxPos = db
    .prepare(
      "SELECT COALESCE(MAX(group_position), -1) AS max_pos FROM tasks WHERE group_id = ?",
    )
    .get(groupId) as { max_pos: number };

  const stmt = db.prepare(
    "UPDATE tasks SET group_id = ?, group_position = ? WHERE id = ?",
  );
  taskIds.forEach((taskId, idx) => {
    stmt.run(groupId, maxPos.max_pos + 1 + idx, taskId);
  });
}

export function removeTaskFromGroup(
  db: DatabaseSync,
  groupId: string,
  taskId: string,
): void {
  db.prepare(
    "UPDATE tasks SET group_id = NULL, group_position = 0 WHERE id = ? AND group_id = ?",
  ).run(taskId, groupId);
}

function generateId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
