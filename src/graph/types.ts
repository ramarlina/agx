const TERMINAL_NODE_STATUSES = ['done', 'passed', 'failed', 'skipped'];
const SUCCESS_NODE_STATUSES = ['done', 'passed'];
const FAILURE_NODE_STATUSES = ['failed'];
const INCOMPLETE_FOR_DONE_STATUSES = ['pending', 'running', 'awaiting_human', 'blocked'];

function isTerminalStatus(status) {
    return TERMINAL_NODE_STATUSES.includes(status);
}

function isIncompleteStatus(status) {
    return INCOMPLETE_FOR_DONE_STATUSES.includes(status);
}

module.exports = {
    TERMINAL_NODE_STATUSES,
    SUCCESS_NODE_STATUSES,
    FAILURE_NODE_STATUSES,
    INCOMPLETE_FOR_DONE_STATUSES,
    isTerminalStatus,
    isIncompleteStatus,
};
