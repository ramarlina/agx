/**
 * @jest-environment node
 */

import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import os from "os";
import path from "path";

import { runTaskIdentifierMigration } from "@/lib/migrations/task-identifier-migration";

function repoRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

function loadBoardSchema(root: string): string {
  return fs.readFileSync(
    path.join(root, "db/sqlite/001_agx_board_schema.sql"),
    "utf8"
  );
}

/**
 * Allocate a per-project identifier in the same way `createTask` does — kept
 * minimal here to directly exercise the counter behaviour without dragging in
 * the full task insert/notification pipeline.
 */
function allocateIdentifier(
  db: DatabaseSync,
  projectId: string
): string | null {
  const row = db
    .prepare(
      "SELECT identifier_prefix, next_identifier FROM projects WHERE id = ?"
    )
    .get(projectId) as
    | { identifier_prefix: string | null; next_identifier: number }
    | undefined;
  if (!row || !row.identifier_prefix) return null;
  const id = `${row.identifier_prefix}-${row.next_identifier}`;
  db.prepare("UPDATE projects SET next_identifier = ? WHERE id = ?").run(
    row.next_identifier + 1,
    projectId
  );
  return id;
}

function insertTask(
  db: DatabaseSync,
  {
    id,
    projectId,
    content,
    slug,
    identifier,
  }: {
    id: string;
    projectId: string | null;
    content: string;
    slug: string;
    identifier: string | null;
  }
): void {
  db.prepare(
    `INSERT INTO tasks (id, project_id, content, slug, identifier) VALUES (?, ?, ?, ?, ?)`
  ).run(id, projectId, content, slug, identifier);
}

describe("task identifier allocation + lookup", () => {
  let tempDir: string;
  let dbPath: string;
  let db: DatabaseSync;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-task-identifier-"));
    dbPath = path.join(tempDir, "agx-board.db");
    db = new DatabaseSync(dbPath);
    db.exec(loadBoardSchema(repoRoot()));
    // Idempotent migration should be a no-op on a fresh schema, but run it
    // to prove it doesn't regress the new columns/index.
    runTaskIdentifierMigration(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("allocates TSK-1, TSK-2 for tasks in a project with identifier_prefix", () => {
    db.prepare(
      "INSERT INTO projects (id, user_id, name, slug, identifier_prefix) VALUES (?, ?, ?, ?, ?)"
    ).run("project-a", "user-1", "Project A", "project-a", "TSK");

    const first = allocateIdentifier(db, "project-a");
    insertTask(db, {
      id: "task-a1",
      projectId: "project-a",
      content: "first",
      slug: "first",
      identifier: first,
    });

    const second = allocateIdentifier(db, "project-a");
    insertTask(db, {
      id: "task-a2",
      projectId: "project-a",
      content: "second",
      slug: "second",
      identifier: second,
    });

    expect(first).toBe("TSK-1");
    expect(second).toBe("TSK-2");

    const row = db
      .prepare("SELECT next_identifier FROM projects WHERE id = ?")
      .get("project-a") as { next_identifier: number };
    expect(row.next_identifier).toBe(3);

    const identifiers = (db
      .prepare(
        "SELECT identifier FROM tasks WHERE project_id = ? ORDER BY identifier"
      )
      .all("project-a") as { identifier: string }[]).map((r) => r.identifier);
    expect(identifiers).toEqual(["TSK-1", "TSK-2"]);
  });

  test("project without identifier_prefix yields tasks with identifier = null", () => {
    db.prepare(
      "INSERT INTO projects (id, user_id, name, slug) VALUES (?, ?, ?, ?)"
    ).run("project-b", "user-1", "Project B", "project-b");

    const allocated = allocateIdentifier(db, "project-b");
    expect(allocated).toBeNull();

    insertTask(db, {
      id: "task-b1",
      projectId: "project-b",
      content: "no-prefix",
      slug: "no-prefix",
      identifier: allocated,
    });

    const row = db
      .prepare("SELECT identifier FROM tasks WHERE id = ?")
      .get("task-b1") as { identifier: string | null };
    expect(row.identifier).toBeNull();
  });

  test("partial unique index rejects duplicate (project_id, identifier) but allows many NULLs", () => {
    db.prepare(
      "INSERT INTO projects (id, user_id, name, slug, identifier_prefix) VALUES (?, ?, ?, ?, ?)"
    ).run("project-c", "user-1", "Project C", "project-c", "AGX");

    insertTask(db, {
      id: "task-c1",
      projectId: "project-c",
      content: "one",
      slug: "c1",
      identifier: "AGX-1",
    });

    expect(() =>
      insertTask(db, {
        id: "task-c2",
        projectId: "project-c",
        content: "two",
        slug: "c2",
        identifier: "AGX-1",
      })
    ).toThrow();

    // NULLs don't collide with each other.
    insertTask(db, {
      id: "task-c3",
      projectId: "project-c",
      content: "three",
      slug: "c3",
      identifier: null,
    });
    insertTask(db, {
      id: "task-c4",
      projectId: "project-c",
      content: "four",
      slug: "c4",
      identifier: null,
    });

    const count = (db
      .prepare(
        "SELECT count(*) as cnt FROM tasks WHERE project_id = ? AND identifier IS NULL"
      )
      .get("project-c") as { cnt: number }).cnt;
    expect(count).toBe(2);
  });

  test("migration is idempotent — running twice does not throw", () => {
    runTaskIdentifierMigration(db);
    runTaskIdentifierMigration(db);

    const projectCols = (db
      .prepare("PRAGMA table_info(projects)")
      .all() as { name: string }[]).map((c) => c.name);
    expect(projectCols).toContain("identifier_prefix");
    expect(projectCols).toContain("next_identifier");

    const taskCols = (db
      .prepare("PRAGMA table_info(tasks)")
      .all() as { name: string }[]).map((c) => c.name);
    expect(taskCols).toContain("identifier");
  });
});
