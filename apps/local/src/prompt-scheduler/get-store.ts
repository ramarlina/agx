import { PromptJobStore } from './store';
import { readFileSync } from 'fs';
import path from 'path';
import { getSQLiteDb } from '@/lib/sqlite-query-adapter';

let _store: PromptJobStore | null = null;

function splitSqlStatements(sql: string): string[] {
  return sql
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((stmt) => stmt.trim())
    .filter(Boolean);
}

export function getPromptJobStore(): PromptJobStore {
  if (!_store) {
    const db = getSQLiteDb();
    const tableExists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='prompt_jobs'")
      .get();
    if (!tableExists) {
      const migration = readFileSync(
        path.join(process.cwd(), 'db/sqlite/002_prompt_scheduler_schema.sql'),
        'utf-8',
      );
      db.exec(migration);
    } else {
      // Run v2 migration if provider column doesn't exist yet
      const hasCatchUp = db
        .prepare("SELECT 1 FROM pragma_table_info('prompt_jobs') WHERE name='catch_up_policy'")
        .get();
      if (!hasCatchUp) {
        // Run each ALTER individually — some columns may already exist from a partial previous run
        const v2Migration = readFileSync(
          path.join(process.cwd(), 'db/sqlite/003_prompt_scheduler_v2.sql'),
          'utf-8',
        );
        for (const stmt of splitSqlStatements(v2Migration)) {
          try {
            db.exec(stmt);
          } catch (err: any) {
            // Ignore "duplicate column" errors from partial migrations
            if (!err.message?.includes('duplicate column')) throw err;
          }
        }
      }
    }
    // Run v3 migration if host_pid column doesn't exist on prompt_runs
    const hasHostPid = db
      .prepare("SELECT 1 FROM pragma_table_info('prompt_runs') WHERE name='host_pid'")
      .get();
    if (!hasHostPid) {
      const v3Migration = readFileSync(
        path.join(process.cwd(), 'db/sqlite/004_prompt_runs_host_pid.sql'),
        'utf-8',
      );
      for (const stmt of splitSqlStatements(v3Migration)) {
        try {
          db.exec(stmt);
        } catch (err: any) {
          if (!err.message?.includes('duplicate column')) throw err;
        }
      }
    }

    _store = new PromptJobStore(db);
  }
  return _store;
}
