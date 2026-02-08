-- Local AGX Board schema for standalone Postgres (no Db auth dependency)

create extension if not exists "pgcrypto";

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  content text not null,
  description text,
  title text,
  slug text unique,
  status text default 'queued' check (status in ('queued', 'in_progress', 'blocked', 'completed', 'failed')),
  stage text default 'ideation' check (stage in ('ideation', 'planning', 'coding', 'qa', 'acceptance', 'pr', 'pr_review', 'merge', 'done')),
  project text,
  project_id uuid,
  priority int default 0,
  engine text default 'claude',
  provider text,
  model text,
  swarm boolean default false,
  swarm_models jsonb,
  retry_count int default 0,
  error text,
  stage_decisions jsonb default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  signature text,
  claimed_by uuid,
  claimed_at timestamptz,
  orchestrator text not null default 'temporal',
  workflow_id text,
  workflow_run_id text,
  orchestration_status text,
  last_orchestration_update timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_tasks_queue on tasks(status, priority, created_at) where status = 'queued';
create index if not exists idx_tasks_user on tasks(user_id);
create index if not exists idx_tasks_project on tasks(project) where project is not null;

create table if not exists task_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks on delete cascade not null,
  content text not null,
  log_type text default 'output' check (log_type in ('output', 'error', 'system', 'checkpoint')),
  created_at timestamptz default now()
);
create index if not exists idx_task_logs_task on task_logs(task_id, created_at);

create table if not exists task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks on delete cascade not null,
  author_type text default 'user' check (author_type in ('user', 'agent')),
  author_id text,
  content text not null,
  created_at timestamptz default now(),
  deleted_at timestamptz
);
create index if not exists idx_task_comments_task on task_comments(task_id, created_at);

create table if not exists learnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  scope text not null check (scope in ('task', 'project', 'global')),
  scope_id text,
  content text not null,
  created_at timestamptz default now()
);
create index if not exists idx_learnings_scope on learnings(scope, scope_id);
create index if not exists idx_learnings_user on learnings(user_id);

create table if not exists stage_prompts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  stage text not null check (stage in ('ideation', 'planning', 'coding', 'qa', 'acceptance', 'pr', 'pr_review', 'merge', 'done')),
  prompt text not null,
  outputs text[],
  is_default boolean default false,
  swarm boolean default false,
  provider text,
  model text,
  swarm_models jsonb,
  created_at timestamptz default now(),
  unique(stage, user_id)
);

create unique index if not exists uniq_stage_prompt_default
  on stage_prompts(stage)
  where is_default = true;

create table if not exists task_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  task_id uuid references tasks on delete set null,
  action text not null check (action in ('dispatch', 'execute', 'complete', 'reject', 'fail')),
  payload jsonb not null,
  signature text not null,
  ip_address inet,
  user_agent text,
  dispatched_at timestamptz default now(),
  executed_at timestamptz,
  result text check (result in ('pending', 'success', 'rejected', 'failed'))
);

create index if not exists idx_audit_user on task_audit_log(user_id, dispatched_at desc);
create index if not exists idx_audit_task on task_audit_log(task_id);

create table if not exists user_secrets (
  user_id uuid primary key,
  daemon_secret_hash text not null,
  created_at timestamptz default now(),
  rotated_at timestamptz
);

create table if not exists rate_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  endpoint text not null,
  window_start timestamptz not null,
  request_count int default 1,
  unique(user_id, endpoint, window_start)
);

create table if not exists device_codes (
  id uuid primary key default gen_random_uuid(),
  device_code text unique not null,
  user_code text unique not null,
  status text not null check (status in ('pending', 'approved', 'expired', 'denied')),
  user_id uuid,
  access_token text,
  refresh_token text,
  created_at timestamptz default now(),
  expires_at timestamptz not null
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null,
  slug text not null,
  description text,
  metadata jsonb,
  ci_cd_info text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, slug)
);

create index if not exists idx_projects_user on projects(user_id, created_at desc);

create table if not exists project_repos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  path text,
  git_url text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_project_repos_project on project_repos(project_id);

alter table tasks
  add constraint fk_tasks_project
  foreign key (project_id) references projects(id) on delete set null;

create table if not exists task_workflow_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  workflow_id text not null,
  run_id text,
  event_type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_workflow_events_task_id on task_workflow_events(task_id, created_at desc);
create index if not exists idx_task_workflow_events_workflow_id on task_workflow_events(workflow_id, created_at desc);
