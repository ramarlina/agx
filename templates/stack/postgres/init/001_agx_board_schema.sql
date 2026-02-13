-- AGX Board schema — idempotent local version of agx-cloud/db/migrations/001_initial_schema.sql
-- Source of truth: agx-cloud/db/migrations/001_initial_schema.sql
-- This file strips RLS policies and auth.uid() references for standalone Postgres.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE SCHEMA IF NOT EXISTS public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE SCHEMA IF NOT EXISTS agx;

SELECT pg_catalog.set_config('search_path', 'agx, public', false);

-- Functions

CREATE OR REPLACE FUNCTION agx.check_rate_limit(p_user_id uuid, p_endpoint text, p_max_requests integer, p_window_seconds integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  v_window_start := date_trunc('minute', now()) -
    ((extract(minute from now())::int % (p_window_seconds / 60)) || ' minutes')::interval;

  insert into agx.rate_limits (user_id, endpoint, window_start, request_count)
  values (p_user_id, p_endpoint, v_window_start, 1)
  on conflict (user_id, endpoint, window_start)
  do update set request_count = agx.rate_limits.request_count + 1
  returning request_count into v_count;

  return v_count <= p_max_requests;
end;
$$;

CREATE OR REPLACE FUNCTION agx.increment_task_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.version = old.version + 1;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION agx.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Tables

CREATE TABLE IF NOT EXISTS agx.device_codes (
    device_code text NOT NULL PRIMARY KEY,
    user_code text NOT NULL UNIQUE,
    status text NOT NULL,
    user_id uuid,
    access_token text,
    refresh_token text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT device_codes_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'expired'::text, 'denied'::text])))
);

CREATE TABLE IF NOT EXISTS agx.learnings (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid,
    scope text NOT NULL,
    scope_id text,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT learnings_scope_check CHECK ((scope = ANY (ARRAY['task'::text, 'project'::text, 'global'::text])))
);

CREATE TABLE IF NOT EXISTS agx.project_repos (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    project_id uuid NOT NULL,
    name text NOT NULL,
    path text,
    git_url text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS agx.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    ci_cd_info text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workflow_id uuid
);

CREATE TABLE IF NOT EXISTS agx.rate_limits (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    request_count integer DEFAULT 1,
    UNIQUE (user_id, endpoint, window_start)
);

CREATE TABLE IF NOT EXISTS agx.stage_prompts (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid,
    stage text NOT NULL,
    prompt text NOT NULL,
    outputs text[],
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    swarm boolean DEFAULT false,
    provider text,
    model text,
    swarm_models jsonb,
    workflow_id uuid
);

CREATE TABLE IF NOT EXISTS agx.task_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    provider text,
    model text,
    content text NOT NULL,
    is_public boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS task_templates_public_slug_idx ON agx.task_templates (slug) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS task_templates_user_slug_idx ON agx.task_templates (user_id, slug) WHERE user_id IS NOT NULL;

-- Per-user preferences (default provider/model), shared between CLI and web.
-- `changed_at` is the user-visible last-change timestamp (may come from clients);
-- `updated_at` is server-maintained via trigger.
CREATE TABLE IF NOT EXISTS agx.user_settings (
    user_id uuid NOT NULL PRIMARY KEY,
    default_provider text,
    models jsonb DEFAULT '{}'::jsonb NOT NULL,
    provenance text DEFAULT 'web'::text NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_settings_provenance_check CHECK ((provenance = ANY (ARRAY['cli'::text, 'web'::text])))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_settings_updated_at'
  ) THEN
    CREATE TRIGGER trg_user_settings_updated_at
    BEFORE UPDATE ON agx.user_settings
    FOR EACH ROW
    EXECUTE FUNCTION agx.update_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agx.task_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid,
    task_id uuid,
    action text NOT NULL,
    payload jsonb NOT NULL,
    signature text NOT NULL,
    ip_address inet,
    user_agent text,
    dispatched_at timestamp with time zone DEFAULT now(),
    executed_at timestamp with time zone,
    result text,
    CONSTRAINT task_audit_log_action_check CHECK ((action = ANY (ARRAY['dispatch'::text, 'execute'::text, 'complete'::text, 'reject'::text, 'fail'::text]))),
    CONSTRAINT task_audit_log_result_check CHECK ((result = ANY (ARRAY['pending'::text, 'success'::text, 'rejected'::text, 'failed'::text])))
);

CREATE TABLE IF NOT EXISTS agx.task_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    task_id uuid NOT NULL,
    author_type text NOT NULL,
    author_id uuid,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    CONSTRAINT task_comments_author_type_check CHECK ((author_type = ANY (ARRAY['user'::text, 'agent'::text]))),
    CONSTRAINT task_comments_check CHECK ((((author_type = 'user'::text) AND (author_id IS NOT NULL)) OR (author_type = 'agent'::text)))
);

CREATE TABLE IF NOT EXISTS agx.task_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    task_id uuid NOT NULL,
    content text NOT NULL,
    log_type text DEFAULT 'output'::text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT task_logs_log_type_check CHECK ((log_type = ANY (ARRAY['output'::text, 'error'::text, 'system'::text, 'checkpoint'::text, 'comment'::text])))
);

CREATE TABLE IF NOT EXISTS agx.task_costs (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    task_id uuid NOT NULL,
    stage text NOT NULL,
    provider text,
    model text,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    estimated_cost numeric(12,6) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_costs_task_fk FOREIGN KEY (task_id) REFERENCES agx.tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agx.task_run_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    task_id uuid,
    pid integer,
    exit_code integer,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agx.task_workflow_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    workflow_id text NOT NULL,
    run_id text,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS agx.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid,
    content text NOT NULL,
    title text,
    status text DEFAULT 'queued'::text,
    blocked_reason text,
    stage text DEFAULT 'ideation'::text,
    project text,
    priority integer DEFAULT 0,
    engine text DEFAULT 'claude'::text,
    signature text,
    depends_on uuid[] DEFAULT '{}'::uuid[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    claimed_by uuid,
    claimed_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    provider text,
    model text,
    slug text,
    description text,
    swarm_models jsonb,
    retry_count integer DEFAULT 0,
    error text,
    stage_decisions jsonb DEFAULT '{}'::jsonb,
    project_id uuid,
    orchestrator text DEFAULT 'temporal'::text NOT NULL,
    workflow_id text,
    workflow_run_id text,
    orchestration_status text,
    last_orchestration_update timestamp with time zone,
    version integer DEFAULT 1,
    run_index jsonb DEFAULT '[]'::jsonb NOT NULL,
    pid integer,
    exit_code integer,
    artifact_path text,
    artifact_host text,
    artifact_key text,
    created_by text DEFAULT 'user'::text,
    CONSTRAINT tasks_created_by_check CHECK ((created_by = ANY (ARRAY['user'::text, 'ai'::text]))),
    CONSTRAINT tasks_stage_check CHECK ((stage = ANY (ARRAY['ideation'::text, 'planning'::text, 'execution'::text, 'verification'::text, 'done'::text]))),
    CONSTRAINT tasks_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'in_progress'::text, 'blocked'::text, 'completed'::text, 'failed'::text])))
);

CREATE TABLE IF NOT EXISTS agx.user_secrets (
    user_id uuid NOT NULL PRIMARY KEY,
    daemon_secret_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    rotated_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS agx.workflow_instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workflow_id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid,
    status text DEFAULT 'pending'::text,
    input jsonb DEFAULT '{}'::jsonb NOT NULL,
    output jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workflow_instances_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
);

CREATE TABLE IF NOT EXISTS agx.workflow_nodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workflow_id uuid NOT NULL,
    name text NOT NULL,
    label text,
    prompt text,
    provider text,
    model text,
    "position" integer NOT NULL,
    node_type text DEFAULT 'step'::text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workflow_nodes_node_type_check CHECK ((node_type = ANY (ARRAY['step'::text, 'gate'::text, 'branch'::text, 'terminal'::text])))
);

CREATE TABLE IF NOT EXISTS agx.workflow_transitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workflow_id uuid NOT NULL,
    from_node_id uuid NOT NULL,
    to_node_id uuid NOT NULL,
    condition text DEFAULT 'done'::text,
    priority integer DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workflow_transitions_condition_check CHECK ((condition = ANY (ARRAY['done'::text, 'blocked'::text, 'failed'::text, 'retry'::text, 'branch_a'::text, 'branch_b'::text])))
);

CREATE TABLE IF NOT EXISTS agx.workflows (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    name text NOT NULL,
    definition jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS agx.agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    name text NOT NULL,
    style text NOT NULL,
    description text,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agents_style_check CHECK ((style = ANY (ARRAY['degen'::text, 'conservative'::text, 'specialist'::text, 'balanced'::text])))
);

-- Unique constraints (idempotent via DO blocks)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_prompts_workflow_stage_is_default_key') THEN
    ALTER TABLE agx.stage_prompts ADD CONSTRAINT stage_prompts_workflow_stage_is_default_key UNIQUE (workflow_id, stage, is_default);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_prompts_workflow_stage_user_id_key') THEN
    ALTER TABLE agx.stage_prompts ADD CONSTRAINT stage_prompts_workflow_stage_user_id_key UNIQUE (workflow_id, stage, user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_transitions_workflow_id_from_node_id_condition_key') THEN
    ALTER TABLE agx.workflow_transitions ADD CONSTRAINT workflow_transitions_workflow_id_from_node_id_condition_key UNIQUE (workflow_id, from_node_id, condition);
  END IF;
END $$;

-- Indexes

CREATE INDEX IF NOT EXISTS device_codes_user_code_idx ON agx.device_codes USING btree (user_code);
CREATE INDEX IF NOT EXISTS idx_audit_task ON agx.task_audit_log USING btree (task_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON agx.task_audit_log USING btree (user_id, dispatched_at DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_scope ON agx.learnings USING btree (scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_learnings_user ON agx.learnings USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_project_repos_project ON agx.project_repos USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_projects_user ON agx.projects USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_user_slug ON agx.projects USING btree (user_id, slug);
CREATE INDEX IF NOT EXISTS idx_projects_workflow ON agx.projects USING btree (workflow_id) WHERE (workflow_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup ON agx.rate_limits USING btree (user_id, endpoint, window_start);
CREATE INDEX IF NOT EXISTS idx_stage_prompts_workflow_id ON agx.stage_prompts USING btree (workflow_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_not_deleted ON agx.task_comments USING btree (task_id, created_at) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON agx.task_comments USING btree (task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_logs_task ON agx.task_logs USING btree (task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_run_history_pid ON agx.task_run_history USING btree (pid);
CREATE INDEX IF NOT EXISTS idx_task_run_history_task_id ON agx.task_run_history USING btree (task_id);
CREATE INDEX IF NOT EXISTS idx_task_workflow_events_task_id_created_at ON agx.task_workflow_events USING btree (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_claimed_by ON agx.tasks USING btree (claimed_by);
CREATE INDEX IF NOT EXISTS idx_tasks_orchestrator ON agx.tasks USING btree (orchestrator);
CREATE INDEX IF NOT EXISTS idx_tasks_pid ON agx.tasks USING btree (pid);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON agx.tasks USING btree (project) WHERE (project IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON agx.tasks USING btree (project_id) WHERE (project_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tasks_queue ON agx.tasks USING btree (status, priority, created_at) WHERE (status = 'queued'::text);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_slug ON agx.tasks USING btree (slug);
CREATE INDEX IF NOT EXISTS idx_tasks_stage_decisions ON agx.tasks USING gin (stage_decisions);
CREATE INDEX IF NOT EXISTS idx_tasks_status_retry ON agx.tasks USING btree (status, retry_count);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON agx.tasks USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workflow_id ON agx.tasks USING btree (workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_project ON agx.workflow_instances USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_status ON agx.workflow_instances USING btree (status);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_user ON agx.workflow_instances USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_workflow ON agx.workflow_instances USING btree (workflow_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_nodes_name ON agx.workflow_nodes USING btree (workflow_id, name);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow ON agx.workflow_nodes USING btree (workflow_id, "position");
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_from ON agx.workflow_transitions USING btree (from_node_id, condition);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_transitions_unique ON agx.workflow_transitions USING btree (workflow_id, from_node_id, condition);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_workflow ON agx.workflow_transitions USING btree (workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflows_user ON agx.workflows USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_agents_user ON agx.agents USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_agents_style ON agx.agents USING btree (style);

-- Triggers (drop + create for idempotency)

DROP TRIGGER IF EXISTS tasks_updated_at ON agx.tasks;
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON agx.tasks FOR EACH ROW EXECUTE FUNCTION agx.update_updated_at();

DROP TRIGGER IF EXISTS trg_increment_task_version ON agx.tasks;
CREATE TRIGGER trg_increment_task_version BEFORE UPDATE ON agx.tasks FOR EACH ROW EXECUTE FUNCTION agx.increment_task_version();

DROP TRIGGER IF EXISTS workflow_instances_updated_at ON agx.workflow_instances;
CREATE TRIGGER workflow_instances_updated_at BEFORE UPDATE ON agx.workflow_instances FOR EACH ROW EXECUTE FUNCTION agx.update_updated_at();

DROP TRIGGER IF EXISTS workflows_updated_at ON agx.workflows;
CREATE TRIGGER workflows_updated_at BEFORE UPDATE ON agx.workflows FOR EACH ROW EXECUTE FUNCTION agx.update_updated_at();

DROP TRIGGER IF EXISTS agents_updated_at ON agx.agents;
CREATE TRIGGER agents_updated_at BEFORE UPDATE ON agx.agents FOR EACH ROW EXECUTE FUNCTION agx.update_updated_at();

-- Foreign keys (idempotent via DO blocks)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_repos_project_id_fkey') THEN
    ALTER TABLE agx.project_repos ADD CONSTRAINT project_repos_project_id_fkey FOREIGN KEY (project_id) REFERENCES agx.projects(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_workflow_id_fkey') THEN
    ALTER TABLE agx.projects ADD CONSTRAINT projects_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES agx.workflows(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_prompts_workflow_id_fkey') THEN
    ALTER TABLE agx.stage_prompts ADD CONSTRAINT stage_prompts_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES agx.workflows(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_audit_log_task_id_fkey') THEN
    ALTER TABLE agx.task_audit_log ADD CONSTRAINT task_audit_log_task_id_fkey FOREIGN KEY (task_id) REFERENCES agx.tasks(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_comments_task_id_fkey') THEN
    ALTER TABLE agx.task_comments ADD CONSTRAINT task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES agx.tasks(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_logs_task_id_fkey') THEN
    ALTER TABLE agx.task_logs ADD CONSTRAINT task_logs_task_id_fkey FOREIGN KEY (task_id) REFERENCES agx.tasks(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_run_history_task_id_fkey') THEN
    ALTER TABLE agx.task_run_history ADD CONSTRAINT task_run_history_task_id_fkey FOREIGN KEY (task_id) REFERENCES agx.tasks(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_workflow_events_task_id_fkey') THEN
    ALTER TABLE agx.task_workflow_events ADD CONSTRAINT task_workflow_events_task_id_fkey FOREIGN KEY (task_id) REFERENCES agx.tasks(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_project_id_fkey') THEN
    ALTER TABLE agx.tasks ADD CONSTRAINT tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES agx.projects(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_instances_project_id_fkey') THEN
    ALTER TABLE agx.workflow_instances ADD CONSTRAINT workflow_instances_project_id_fkey FOREIGN KEY (project_id) REFERENCES agx.projects(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_instances_workflow_id_fkey') THEN
    ALTER TABLE agx.workflow_instances ADD CONSTRAINT workflow_instances_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES agx.workflows(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_nodes_workflow_id_fkey') THEN
    ALTER TABLE agx.workflow_nodes ADD CONSTRAINT workflow_nodes_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES agx.workflows(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_transitions_from_node_id_fkey') THEN
    ALTER TABLE agx.workflow_transitions ADD CONSTRAINT workflow_transitions_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES agx.workflow_nodes(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_transitions_to_node_id_fkey') THEN
    ALTER TABLE agx.workflow_transitions ADD CONSTRAINT workflow_transitions_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES agx.workflow_nodes(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_transitions_workflow_id_fkey') THEN
    ALTER TABLE agx.workflow_transitions ADD CONSTRAINT workflow_transitions_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES agx.workflows(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Idempotent column additions for existing installations
ALTER TABLE agx.tasks ADD COLUMN IF NOT EXISTS artifact_path text;
ALTER TABLE agx.tasks ADD COLUMN IF NOT EXISTS artifact_host text;
ALTER TABLE agx.tasks ADD COLUMN IF NOT EXISTS artifact_key text;
ALTER TABLE agx.tasks ADD COLUMN IF NOT EXISTS created_by text DEFAULT 'user'::text;
