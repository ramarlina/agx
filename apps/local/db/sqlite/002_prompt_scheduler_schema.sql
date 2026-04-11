-- Prompt Scheduler tables
CREATE TABLE IF NOT EXISTS prompt_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    cli TEXT NOT NULL DEFAULT 'claude',
    agent_id TEXT DEFAULT NULL REFERENCES agents(id) ON DELETE SET NULL,
    project_id TEXT DEFAULT NULL,
    objective_id TEXT DEFAULT NULL,
    objective_key TEXT DEFAULT NULL,
    provider TEXT NOT NULL DEFAULT 'claude',
    model TEXT NOT NULL DEFAULT '',
    cli_args TEXT NOT NULL DEFAULT '',
    cron_expr TEXT NOT NULL,
    cadence TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused', 'stopped')),
    overlap_policy TEXT NOT NULL DEFAULT 'skip' CHECK (overlap_policy IN ('skip', 'queue', 'allow')),
    catch_up_policy TEXT NOT NULL DEFAULT 'fire_once' CHECK (catch_up_policy IN ('fire_once', 'replay_all', 'skip')),
    cancel_check_sec INTEGER NOT NULL DEFAULT 5,
    trigger_type TEXT NOT NULL DEFAULT 'scheduled' CHECK (trigger_type IN ('scheduled', 'condition')),
    condition TEXT NOT NULL DEFAULT '',
    check_every_ms INTEGER NOT NULL DEFAULT 300000,
    next_run_at INTEGER,
    last_run_at INTEGER,
    last_outcome TEXT CHECK (last_outcome IS NULL OR last_outcome IN ('queued', 'running', 'success', 'failed', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prompt_jobs_state ON prompt_jobs(state);
CREATE INDEX IF NOT EXISTS idx_prompt_jobs_next_run_at ON prompt_jobs(next_run_at);

CREATE TABLE IF NOT EXISTS prompt_runs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES prompt_jobs(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
    output TEXT,
    error TEXT,
    duration_ms INTEGER,
    started_at TEXT,
    finished_at TEXT,
    cancelled_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prompt_runs_job_id ON prompt_runs(job_id);
CREATE INDEX IF NOT EXISTS idx_prompt_runs_status ON prompt_runs(status);
