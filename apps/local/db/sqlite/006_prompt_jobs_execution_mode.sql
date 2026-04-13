-- Prompt Scheduler v5: execution mode metadata for prompt jobs
ALTER TABLE prompt_jobs ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'prompt';

