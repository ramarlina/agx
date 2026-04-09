-- Track host PID and command for running prompt runs so stale runs can be
-- detected by checking whether the original process is still alive.
ALTER TABLE prompt_runs ADD COLUMN host_pid INTEGER DEFAULT NULL;
ALTER TABLE prompt_runs ADD COLUMN host_command TEXT DEFAULT NULL;
