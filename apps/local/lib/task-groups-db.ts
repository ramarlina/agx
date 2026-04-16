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
): TaskGroupWithTaskIds {
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
      "INSERT OR IGNORE INTO task_group_items (group_id, item_id, position) VALUES (?, ?, ?)",
    );
    taskIds.forEach((taskId, idx) => {
      stmt.run(id, taskId, idx);
    });
  }

  const group = db.prepare("SELECT * FROM task_groups WHERE id = ?").get(id) as unknown as TaskGroup;
  return { ...group, task_ids: taskIds };
}

export function listTaskGroups(
  db: DatabaseSync,
  projectId: string,
): TaskGroupWithTaskIds[] {
  const groups = db
    .prepare("SELECT * FROM task_groups WHERE project_id = ? ORDER BY position ASC")
    .all(projectId) as unknown as TaskGroup[];

  return groups.map((group) => {
    const items = db
      .prepare("SELECT item_id FROM task_group_items WHERE group_id = ? ORDER BY position ASC")
      .all(group.id) as unknown as { item_id: string }[];
    return { ...group, task_ids: items.map((t) => t.item_id) };
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
  db.prepare("DELETE FROM task_group_items WHERE group_id = ?").run(groupId);
  db.prepare("DELETE FROM task_groups WHERE id = ?").run(groupId);
}

export function assignTasksToGroup(
  db: DatabaseSync,
  groupId: string,
  taskIds: string[],
): void {
  const maxPos = db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) AS max_pos FROM task_group_items WHERE group_id = ?",
    )
    .get(groupId) as { max_pos: number };

  const stmt = db.prepare(
    "INSERT OR IGNORE INTO task_group_items (group_id, item_id, position) VALUES (?, ?, ?)",
  );
  taskIds.forEach((taskId, idx) => {
    stmt.run(groupId, taskId, maxPos.max_pos + 1 + idx);
  });
}

export function removeTaskFromGroup(
  db: DatabaseSync,
  groupId: string,
  taskId: string,
): void {
  db.prepare(
    "DELETE FROM task_group_items WHERE group_id = ? AND item_id = ?",
  ).run(groupId, taskId);
}

function generateId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
