import { randomUUID } from "crypto";
import { getSQLiteDb } from "./sqlite-query-adapter";
import { transactionFn } from "./sqlite-compat";

export type ThreadKnowledgeScope = "repo" | "project";
export type ThreadKnowledgeRunStatus = "running" | "completed" | "failed";

export interface ThreadKnowledgeRun {
  id: string;
  threadId: string;
  rootMessageId: string;
  status: ThreadKnowledgeRunStatus;
  requestedScopes: ThreadKnowledgeScope[];
  repoInsertedCount: number;
  projectInsertedCount: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

function parseScopes(raw: string | null): ThreadKnowledgeScope[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is ThreadKnowledgeScope => value === "repo" || value === "project");
  } catch {
    return [];
  }
}

function mapRow(row: {
  id: string;
  thread_id: string;
  root_message_id: string;
  status: ThreadKnowledgeRunStatus;
  requested_scopes: string | null;
  repo_inserted_count: number;
  project_inserted_count: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}): ThreadKnowledgeRun {
  return {
    id: row.id,
    threadId: row.thread_id,
    rootMessageId: row.root_message_id,
    status: row.status,
    requestedScopes: parseScopes(row.requested_scopes),
    repoInsertedCount: Number(row.repo_inserted_count ?? 0),
    projectInsertedCount: Number(row.project_inserted_count ?? 0),
    error: row.error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
  };
}

export function getLatestThreadKnowledgeRun(rootMessageId: string): ThreadKnowledgeRun | null {
  const db = getSQLiteDb();
  const row = db
    .prepare(
      `SELECT id, thread_id, root_message_id, status, requested_scopes,
              repo_inserted_count, project_inserted_count, error,
              created_at, updated_at, completed_at
       FROM thread_knowledge_runs
       WHERE root_message_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(rootMessageId) as {
    id: string;
    thread_id: string;
    root_message_id: string;
    status: ThreadKnowledgeRunStatus;
    requested_scopes: string | null;
    repo_inserted_count: number;
    project_inserted_count: number;
    error: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
  } | undefined;

  return row ? mapRow(row) : null;
}

export function startThreadKnowledgeRun(input: {
  threadId: string;
  rootMessageId: string;
  scopes: ThreadKnowledgeScope[];
}): { run: ThreadKnowledgeRun; reused: boolean } {
  const db = getSQLiteDb();
  const now = new Date().toISOString();
  const tx = transactionFn(db, (args: {
    threadId: string;
    rootMessageId: string;
    scopes: ThreadKnowledgeScope[];
  }): { run: ThreadKnowledgeRun; reused: boolean } => {
    const existing = db
      .prepare(
        `SELECT id, thread_id, root_message_id, status, requested_scopes,
                repo_inserted_count, project_inserted_count, error,
                created_at, updated_at, completed_at
         FROM thread_knowledge_runs
         WHERE root_message_id = ? AND status = 'running'
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(args.rootMessageId) as {
      id: string;
      thread_id: string;
      root_message_id: string;
      status: ThreadKnowledgeRunStatus;
      requested_scopes: string | null;
      repo_inserted_count: number;
      project_inserted_count: number;
      error: string | null;
      created_at: string;
      updated_at: string;
      completed_at: string | null;
    } | undefined;

    if (existing) {
      return { run: mapRow(existing), reused: true };
    }

    const id = randomUUID();
    const requestedScopes = Array.from(new Set(args.scopes));
    db.prepare(
      `INSERT INTO thread_knowledge_runs (
        id, thread_id, root_message_id, status, requested_scopes,
        repo_inserted_count, project_inserted_count, error,
        created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, 'running', ?, 0, 0, NULL, ?, ?, NULL)`
    ).run(id, args.threadId, args.rootMessageId, JSON.stringify(requestedScopes), now, now);

    const created = db
      .prepare(
        `SELECT id, thread_id, root_message_id, status, requested_scopes,
                repo_inserted_count, project_inserted_count, error,
                created_at, updated_at, completed_at
         FROM thread_knowledge_runs
         WHERE id = ?`
      )
      .get(id) as {
      id: string;
      thread_id: string;
      root_message_id: string;
      status: ThreadKnowledgeRunStatus;
      requested_scopes: string | null;
      repo_inserted_count: number;
      project_inserted_count: number;
      error: string | null;
      created_at: string;
      updated_at: string;
      completed_at: string | null;
    };

    return { run: mapRow(created), reused: false };
  });

  return tx(input);
}

export function completeThreadKnowledgeRun(input: {
  runId: string;
  repoInsertedCount: number;
  projectInsertedCount: number;
}): ThreadKnowledgeRun | null {
  const db = getSQLiteDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE thread_knowledge_runs
     SET status = 'completed',
         repo_inserted_count = ?,
         project_inserted_count = ?,
         error = NULL,
         updated_at = ?,
         completed_at = ?
     WHERE id = ?`
  ).run(input.repoInsertedCount, input.projectInsertedCount, now, now, input.runId);
  return getThreadKnowledgeRunById(input.runId);
}

export function failThreadKnowledgeRun(runId: string, error: string): ThreadKnowledgeRun | null {
  const db = getSQLiteDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE thread_knowledge_runs
     SET status = 'failed',
         error = ?,
         updated_at = ?,
         completed_at = ?
     WHERE id = ?`
  ).run(error.trim().slice(0, 1000) || "Thread knowledge extraction failed", now, now, runId);
  return getThreadKnowledgeRunById(runId);
}

function getThreadKnowledgeRunById(runId: string): ThreadKnowledgeRun | null {
  const db = getSQLiteDb();
  const row = db
    .prepare(
      `SELECT id, thread_id, root_message_id, status, requested_scopes,
              repo_inserted_count, project_inserted_count, error,
              created_at, updated_at, completed_at
       FROM thread_knowledge_runs
       WHERE id = ?
       LIMIT 1`
    )
    .get(runId) as {
    id: string;
    thread_id: string;
    root_message_id: string;
    status: ThreadKnowledgeRunStatus;
    requested_scopes: string | null;
    repo_inserted_count: number;
    project_inserted_count: number;
    error: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
  } | undefined;

  return row ? mapRow(row) : null;
}
