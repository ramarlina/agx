-- Prompt Scheduler v2: provider/model, cli args, conditions, agent
ALTER TABLE prompt_jobs ADD COLUMN agent_id TEXT DEFAULT NULL REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE prompt_jobs ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude';
ALTER TABLE prompt_jobs ADD COLUMN model TEXT NOT NULL DEFAULT '';
ALTER TABLE prompt_jobs ADD COLUMN cli_args TEXT NOT NULL DEFAULT '';
ALTER TABLE prompt_jobs ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'scheduled' CHECK (trigger_type IN ('scheduled', 'condition'));
ALTER TABLE prompt_jobs ADD COLUMN condition TEXT NOT NULL DEFAULT '';
ALTER TABLE prompt_jobs ADD COLUMN check_every_ms INTEGER NOT NULL DEFAULT 300000;
ALTER TABLE prompt_jobs ADD COLUMN project_id TEXT DEFAULT NULL;
ALTER TABLE prompt_jobs ADD COLUMN catch_up_policy TEXT NOT NULL DEFAULT 'fire_once' CHECK (catch_up_policy IN ('fire_once', 'replay_all', 'skip'));

-- Migrate old 'cli' column data into 'provider'
UPDATE prompt_jobs SET provider = cli WHERE cli IN ('claude', 'codex', 'gemini');
