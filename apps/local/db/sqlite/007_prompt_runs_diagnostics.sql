-- Add diagnostic columns for failed runs: exit code and tail logs.
ALTER TABLE prompt_runs ADD COLUMN exit_code INTEGER DEFAULT NULL;
ALTER TABLE prompt_runs ADD COLUMN logs TEXT DEFAULT NULL;
