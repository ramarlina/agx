const TERMINAL_NODE_STATUSES = ['done', 'passed', 'failed', 'skipped'];
const SUCCESS_NODE_STATUSES = ['done', 'passed'];
const FAILURE_NODE_STATUSES = ['failed'];
const SOFT_DEP_SATISFIED_STATUSES = ['done', 'passed', 'failed', 'skipped', 'blocked'];
const INCOMPLETE_FOR_DONE_STATUSES = ['pending', 'running', 'awaiting_human', 'blocked'];

const DEFAULT_EXECUTION_POLICY = {
    replanBudgetRemaining: 3,
    replanBudgetInitial: 3,
    verifyBudgetRemaining: 5,
    verifyBudgetInitial: 5,
    maxConcurrentAutoChecks: 1,
    immutableRequiredGates: true,
    maxConcurrent: 3,
    priorityMode: 'fifo',
    nodeTimeoutMs: 30 * 60 * 1000,
    graphTimeoutMs: 24 * 60 * 60 * 1000,
};

module.exports = {
    TERMINAL_NODE_STATUSES,
    SUCCESS_NODE_STATUSES,
    FAILURE_NODE_STATUSES,
    SOFT_DEP_SATISFIED_STATUSES,
    INCOMPLETE_FOR_DONE_STATUSES,
    DEFAULT_EXECUTION_POLICY,
};
