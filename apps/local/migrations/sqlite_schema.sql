-- AGX Board — SQLite target schema for PG→SQLite migration
-- Based on: db/sqlite/001_agx_board_schema.sql
-- Additions: CHECK(json_valid(col)) on all JSON columns
-- Generated: 2026-02-21

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Tables (FK-safe order: referenced before referencing) ─────────────────

CREATE TABLE IF NOT EXISTS device_codes (
    device_code TEXT NOT NULL PRIMARY KEY,
    user_code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    user_id TEXT,
    access_token TEXT,
    refresh_token TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at TEXT NOT NULL,
    CHECK (status IN ('pending', 'approved', 'expired', 'denied'))
);

CREATE TABLE IF NOT EXISTS learnings (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    user_id TEXT,
    scope TEXT NOT NULL,
    scope_id TEXT,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (scope IN ('task', 'project', 'global'))
);

CREATE TABLE IF NOT EXISTS user_secrets (
    user_id TEXT NOT NULL PRIMARY KEY,
    daemon_secret_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    rotated_at TEXT
);

CREATE TABLE IF NOT EXISTS workflows (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    definition JSON NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (json_valid(definition))
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    metadata JSON NOT NULL DEFAULT '{}',
    ci_cd_info TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    workflow_id TEXT REFERENCES workflows(id),
    CHECK (json_valid(metadata))
);

CREATE TABLE IF NOT EXISTS project_repos (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    path TEXT,
    git_url TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS rate_limits (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    window_start TEXT NOT NULL,
    request_count INTEGER DEFAULT 1,
    UNIQUE (user_id, endpoint, window_start)
);

CREATE TABLE IF NOT EXISTS stage_prompts (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    user_id TEXT,
    stage TEXT NOT NULL,
    prompt TEXT NOT NULL,
    outputs JSON,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    swarm INTEGER DEFAULT 0,
    provider TEXT,
    model TEXT,
    swarm_models JSON,
    workflow_id TEXT REFERENCES workflows(id),
    UNIQUE (workflow_id, stage, is_default),
    UNIQUE (workflow_id, stage, user_id),
    CHECK (outputs IS NULL OR json_valid(outputs)),
    CHECK (swarm_models IS NULL OR json_valid(swarm_models))
);

CREATE TABLE IF NOT EXISTS task_templates (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    user_id TEXT,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    provider TEXT,
    model TEXT,
    content TEXT NOT NULL,
    is_public INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT NOT NULL PRIMARY KEY,
    default_provider TEXT,
    models JSON NOT NULL DEFAULT '{}',
    provenance TEXT NOT NULL DEFAULT 'web',
    changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (provenance IN ('cli', 'web')),
    CHECK (json_valid(models))
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    user_id TEXT,
    content TEXT NOT NULL,
    title TEXT,
    status TEXT DEFAULT 'queued',
    blocked_reason TEXT,
    stage TEXT DEFAULT 'INTAKE',
    project TEXT,
    priority INTEGER DEFAULT 0,
    engine TEXT DEFAULT 'claude',
    signature TEXT,
    depends_on JSON DEFAULT '[]',
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    claimed_by TEXT,
    claimed_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    provider TEXT,
    model TEXT,
    slug TEXT,
    description TEXT,
    swarm_models JSON,
    retry_count INTEGER DEFAULT 0,
    error TEXT,
    stage_decisions JSON DEFAULT '{}',
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    orchestrator TEXT NOT NULL DEFAULT 'temporal',
    workflow_id TEXT,
    workflow_run_id TEXT,
    orchestration_status TEXT,
    last_orchestration_update TEXT,
    version INTEGER DEFAULT 1,
    run_index JSON NOT NULL DEFAULT '[]',
    pid INTEGER,
    exit_code INTEGER,
    artifact_path TEXT,
    artifact_host TEXT,
    artifact_key TEXT,
    created_by TEXT DEFAULT 'user',
    current_plan TEXT,
    open_blockers JSON DEFAULT '[]',
    next_action TEXT,
    swarm INTEGER,
    graph_id TEXT,
    CHECK (created_by IN ('user', 'ai')),
    CHECK (status IN ('queued', 'in_progress', 'blocked', 'completed', 'failed')),
    CHECK (json_valid(depends_on)),
    CHECK (swarm_models IS NULL OR json_valid(swarm_models)),
    CHECK (json_valid(stage_decisions)),
    CHECK (json_valid(run_index)),
    CHECK (json_valid(open_blockers))
);

CREATE TABLE IF NOT EXISTS task_audit_log (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    user_id TEXT,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    payload JSON NOT NULL,
    signature TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    dispatched_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    executed_at TEXT,
    result TEXT,
    CHECK (action IN ('dispatch', 'execute', 'complete', 'reject', 'fail')),
    CHECK (result IS NULL OR result IN ('pending', 'success', 'rejected', 'failed')),
    CHECK (json_valid(payload))
);

CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author_type TEXT NOT NULL,
    author_id TEXT,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at TEXT,
    CHECK (author_type IN ('user', 'agent')),
    CHECK ((author_type = 'user' AND author_id IS NOT NULL) OR author_type = 'agent')
);

CREATE TABLE IF NOT EXISTS task_logs (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    log_type TEXT DEFAULT 'output',
    node_id TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (log_type IN ('output', 'error', 'system', 'checkpoint', 'comment'))
);

CREATE TABLE IF NOT EXISTS task_costs (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS task_run_history (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    pid INTEGER,
    exit_code INTEGER,
    started_at TEXT,
    completed_at TEXT,
    error TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS task_workflow_events (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    run_id TEXT,
    event_type TEXT NOT NULL,
    payload JSON NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (json_valid(payload))
);

CREATE TABLE IF NOT EXISTS workflow_instances (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending',
    input JSON NOT NULL DEFAULT '{}',
    output JSON,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    CHECK (json_valid(input)),
    CHECK (output IS NULL OR json_valid(output))
);

CREATE TABLE IF NOT EXISTS workflow_nodes (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    label TEXT,
    prompt TEXT,
    provider TEXT,
    model TEXT,
    "position" INTEGER NOT NULL,
    node_type TEXT DEFAULT 'step',
    metadata JSON DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (node_type IN ('step', 'gate', 'branch', 'terminal')),
    CHECK (metadata IS NULL OR json_valid(metadata))
);

CREATE TABLE IF NOT EXISTS workflow_transitions (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    from_node_id TEXT NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
    to_node_id TEXT NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
    condition TEXT DEFAULT 'done',
    priority INTEGER DEFAULT 0,
    metadata JSON DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (workflow_id, from_node_id, condition),
    CHECK (condition IN ('done', 'blocked', 'failed', 'retry', 'branch_a', 'branch_b')),
    CHECK (metadata IS NULL OR json_valid(metadata))
);

CREATE TABLE IF NOT EXISTS agents (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    style TEXT NOT NULL,
    description TEXT,
    voice TEXT,
    seed TEXT,
    model TEXT,
    provider TEXT,
    color TEXT,
    role TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (style IN ('degen', 'conservative', 'specialist', 'balanced'))
);

CREATE TABLE IF NOT EXISTS agent_skills (
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    condition TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (agent_id, file)
);

CREATE TABLE IF NOT EXISTS skill_learning_history (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    provider TEXT NOT NULL,
    repo TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    skill_label TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
    command TEXT NOT NULL,
    error TEXT,
    run_started_at INTEGER,
    run_completed_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agent_skill_bindings (
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    repo TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    condition TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (agent_id, repo, skill_id)
);

-- ── Execution graph tables (v2 DAG persistence) ────────────────────────────

CREATE TABLE IF NOT EXISTS execution_graphs (
    id TEXT NOT NULL PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    graph_version INTEGER NOT NULL DEFAULT 1,
    mode TEXT NOT NULL,
    policy JSON NOT NULL DEFAULT '{}',
    done_criteria JSON NOT NULL DEFAULT '{}',
    schedule JSON,
    execution_state TEXT NOT NULL DEFAULT 'ready',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (mode IN ('SIMPLE', 'PROJECT')),
    CHECK (execution_state IN ('ready', 'running', 'paused', 'stopped', 'done')),
    CHECK (json_valid(policy)),
    CHECK (json_valid(done_criteria)),
    CHECK (schedule IS NULL OR json_valid(schedule))
);

CREATE TABLE IF NOT EXISTS graph_nodes (
    graph_id TEXT NOT NULL REFERENCES execution_graphs(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    config JSON NOT NULL DEFAULT '{}',
    output JSON,
    metrics JSON,
    PRIMARY KEY (graph_id, node_id),
    CHECK (type IN ('work', 'gate', 'fork', 'join', 'conditional', 'root', 'function')),
    CHECK (status IN ('pending', 'running', 'awaiting_human', 'done', 'passed', 'failed', 'blocked', 'skipped', 'stopped')),
    CHECK (json_valid(config)),
    CHECK (output IS NULL OR json_valid(output)),
    CHECK (metrics IS NULL OR json_valid(metrics))
);

CREATE TABLE IF NOT EXISTS graph_edges (
    graph_id TEXT NOT NULL REFERENCES execution_graphs(id) ON DELETE CASCADE,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    type TEXT NOT NULL,
    condition TEXT,
    data_mapping JSON,
    PRIMARY KEY (graph_id, from_id, to_id, type),
    CHECK (type IN ('hard', 'soft')),
    CHECK (condition IS NULL OR condition IN ('on_success', 'on_failure', 'always')),
    CHECK (data_mapping IS NULL OR json_valid(data_mapping))
);

CREATE TABLE IF NOT EXISTS graph_events (
    graph_id TEXT NOT NULL REFERENCES execution_graphs(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload JSON NOT NULL DEFAULT '{}',
    "timestamp" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (json_valid(payload))
);

CREATE TABLE IF NOT EXISTS graph_migration_backups (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    task_snapshot JSON NOT NULL,
    had_graph_before INTEGER NOT NULL DEFAULT 0,
    previous_graph_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (json_valid(task_snapshot))
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS device_codes_user_code_idx ON device_codes (user_code);
CREATE INDEX IF NOT EXISTS idx_audit_task ON task_audit_log (task_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON task_audit_log (user_id, dispatched_at DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_scope ON learnings (scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_learnings_user ON learnings (user_id);
CREATE INDEX IF NOT EXISTS idx_project_repos_project ON project_repos (project_id);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_user_slug ON projects (user_id, slug);
CREATE INDEX IF NOT EXISTS idx_projects_workflow ON projects (workflow_id) WHERE workflow_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup ON rate_limits (user_id, endpoint, window_start);
CREATE INDEX IF NOT EXISTS idx_stage_prompts_workflow_id ON stage_prompts (workflow_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_not_deleted ON task_comments (task_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments (task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs (task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_logs_node ON task_logs (task_id, node_id, created_at) WHERE node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_run_history_pid ON task_run_history (pid);
CREATE INDEX IF NOT EXISTS idx_task_run_history_task_id ON task_run_history (task_id);
CREATE INDEX IF NOT EXISTS idx_task_workflow_events_task_id_created_at ON task_workflow_events (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_claimed_by ON tasks (claimed_by);
CREATE INDEX IF NOT EXISTS idx_tasks_orchestrator ON tasks (orchestrator);
CREATE INDEX IF NOT EXISTS idx_tasks_pid ON tasks (pid);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks (project) WHERE project IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_queue ON tasks (status, priority, created_at) WHERE status = 'queued';
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_slug ON tasks (slug);
CREATE INDEX IF NOT EXISTS idx_tasks_stage_decisions ON tasks (stage_decisions);
CREATE INDEX IF NOT EXISTS idx_tasks_status_retry ON tasks (status, retry_count);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks (user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workflow_id ON tasks (workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_project ON workflow_instances (project_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_status ON workflow_instances (status);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_user ON workflow_instances (user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_workflow ON workflow_instances (workflow_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_nodes_name ON workflow_nodes (workflow_id, name);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow ON workflow_nodes (workflow_id, "position");
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_from ON workflow_transitions (from_node_id, condition);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_transitions_unique ON workflow_transitions (workflow_id, from_node_id, condition);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_workflow ON workflow_transitions (workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflows_user ON workflows (user_id);
CREATE INDEX IF NOT EXISTS idx_agents_user ON agents (user_id);
CREATE INDEX IF NOT EXISTS idx_agents_style ON agents (style);
CREATE INDEX IF NOT EXISTS idx_agent_skills_agent ON agent_skills (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_skill_bindings_agent ON agent_skill_bindings (agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_learning_history_provider_status_updated ON skill_learning_history(provider, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_learning_history_skill_lookup ON skill_learning_history(provider, repo, skill_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS task_templates_public_slug_idx ON task_templates (slug) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS task_templates_user_slug_idx ON task_templates (user_id, slug) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_graphs_task_id ON execution_graphs (task_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_graph_id ON graph_nodes (graph_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_graph_id ON graph_edges (graph_id);
CREATE INDEX IF NOT EXISTS idx_graph_events_graph_id_timestamp ON graph_events (graph_id, "timestamp");
CREATE INDEX IF NOT EXISTS idx_tasks_graph_id ON tasks (graph_id) WHERE graph_id IS NOT NULL;

-- ── Triggers ────────────────────────────────────────────────────────────────

CREATE TRIGGER IF NOT EXISTS tasks_auto_update
    AFTER UPDATE ON tasks
    FOR EACH ROW
    BEGIN
        UPDATE tasks SET
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            version = OLD.version + 1
        WHERE rowid = NEW.rowid;
    END;

CREATE TRIGGER IF NOT EXISTS trg_user_settings_updated_at
    AFTER UPDATE ON user_settings
    FOR EACH ROW
    BEGIN
        UPDATE user_settings SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE rowid = NEW.rowid;
    END;

CREATE TRIGGER IF NOT EXISTS workflow_instances_updated_at
    AFTER UPDATE ON workflow_instances
    FOR EACH ROW
    BEGIN
        UPDATE workflow_instances SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE rowid = NEW.rowid;
    END;

CREATE TRIGGER IF NOT EXISTS workflows_updated_at
    AFTER UPDATE ON workflows
    FOR EACH ROW
    BEGIN
        UPDATE workflows SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE rowid = NEW.rowid;
    END;

CREATE TRIGGER IF NOT EXISTS agents_updated_at
    AFTER UPDATE ON agents
    FOR EACH ROW
    BEGIN
        UPDATE agents SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE rowid = NEW.rowid;
    END;

CREATE TRIGGER IF NOT EXISTS execution_graphs_auto_update
    AFTER UPDATE ON execution_graphs
    FOR EACH ROW
    BEGIN
        UPDATE execution_graphs SET
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            graph_version = OLD.graph_version + 1
        WHERE rowid = NEW.rowid;
    END;

-- ── Project sub-tables (agent routing, skills, variables, memory, threads) ──

CREATE TABLE IF NOT EXISTS teams (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    template_id TEXT,
    metadata JSON NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (json_valid(metadata))
);

CREATE INDEX IF NOT EXISTS idx_teams_project_id ON teams (project_id);

CREATE TABLE IF NOT EXISTS team_agents (
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    role_key TEXT NOT NULL,
    routing_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (team_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_team_agents_agent_id ON team_agents (agent_id);

CREATE TRIGGER IF NOT EXISTS teams_updated_at
    AFTER UPDATE ON teams
    FOR EACH ROW
    BEGIN
        UPDATE teams SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE rowid = NEW.rowid;
    END;

CREATE TABLE IF NOT EXISTS project_agents (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    routing_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (project_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_project_agents_project ON project_agents (project_id, routing_order);
CREATE INDEX IF NOT EXISTS idx_project_agents_agent ON project_agents (agent_id);

CREATE TABLE IF NOT EXISTS project_skills (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    condition TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_project_skills_project ON project_skills (project_id);

CREATE TABLE IF NOT EXISTS project_variables (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (project_id, key)
);

CREATE INDEX IF NOT EXISTS idx_project_variables_project ON project_variables (project_id);

CREATE TABLE IF NOT EXISTS project_memory (
    id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    source TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_project_memory_project ON project_memory (project_id, created_at);

CREATE TABLE IF NOT EXISTS project_threads (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (project_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_project_threads_thread ON project_threads (thread_id);
