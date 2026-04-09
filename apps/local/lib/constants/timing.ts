// ── UI Polling ──────────────────────────────────────────
export const UI_POLL_DAEMON_STATUS_MS = 10_000;
export const UI_POLL_DB_HEALTH_MS = 30_000;
export const UI_POLL_SYSTEM_STATUS_MS = 30_000;
export const UI_POLL_PROMPT_RUNS_MS = 5_000;
export const UI_POLL_TASK_DURATION_MS = 60_000;
export const UI_POLL_CHAT_CHECK_MS = 10_000;
export const UI_POLL_CHAT_ALT_MS = 15_000;
export const UI_POLL_OFFLINE_CHECK_MS = 30_000;
export const UI_RECONNECT_DELAY_MS = 2_000;

// ── Backend / Infrastructure ────────────────────────────
export const DB_BUSY_TIMEOUT_MS = 5_000;
export const DB_WAL_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;
export const QUEUE_POLL_INTERVAL_MS = 1_000;
export const WRITE_RATE_SAMPLE_WINDOW_MS = 10_000;
export const WRITE_RATE_WARNING_COOLDOWN_MS = 60_000;
export const SCHEDULE_POLL_INTERVAL_MS = 5_000;
export const PS_COMMAND_TIMEOUT_MS = 5_000;

// ── Execution Timeouts ──────────────────────────────────
export const NODE_TIMEOUT_DEFAULT_MS = 30 * 60 * 1000;
export const GRAPH_TIMEOUT_DEFAULT_MS = 24 * 60 * 60 * 1000;
export const BASH_FUNCTION_TIMEOUT_MS = 30_000;
export const CHECK_NPM_TEST_TIMEOUT_MS = 5 * 60 * 1000;
export const CHECK_NPM_LINT_TIMEOUT_MS = 60 * 1000;
export const CHECK_NPM_COVERAGE_TIMEOUT_MS = 5 * 60 * 1000;
export const CHECK_NPM_BUILD_TIMEOUT_MS = 10 * 60 * 1000;
export const CHECK_NPM_TYPECHECK_TIMEOUT_MS = 2 * 60 * 1000;
export const SHELL_COMMAND_TIMEOUT_MS = 5_000;
export const SKILL_FETCH_TIMEOUT_MS = 120_000;

// ── Cache TTLs ──────────────────────────────────────────
export const SKILLS_CACHE_TTL_MS = 60 * 60 * 1000;
export const SKILL_DETAIL_CACHE_TTL_MS = 60 * 60 * 1000;
export const STEER_DUPLICATE_WINDOW_MS = 15 * 60 * 1000;
