-- Prompt Scheduler v4: objective ownership metadata for prompt jobs
ALTER TABLE prompt_jobs ADD COLUMN objective_id TEXT DEFAULT NULL;
ALTER TABLE prompt_jobs ADD COLUMN objective_key TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_prompt_jobs_objective_id ON prompt_jobs(objective_id);
