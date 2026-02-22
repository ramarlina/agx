const {
    DEFAULT_EXECUTION_POLICY,
    FAILURE_NODE_STATUSES,
    INCOMPLETE_FOR_DONE_STATUSES,
    SOFT_DEP_SATISFIED_STATUSES,
    SUCCESS_NODE_STATUSES,
    TERMINAL_NODE_STATUSES,
} = require('./constants');

/**
 * @typedef {'SIMPLE'|'PROJECT'} GraphMode
 * @typedef {'work'|'gate'|'fork'|'join'|'conditional'} NodeType
 * @typedef {'pending'|'running'|'awaiting_human'|'done'|'passed'|'failed'|'blocked'|'skipped'} NodeStatus
 * @typedef {'hard'|'soft'} EdgeType
 * @typedef {'on_success'|'on_failure'|'always'} EdgeCondition
 * @typedef {'fifo'|'critical_path'|'shortest_first'} PriorityMode
 *
 * @typedef {Object} RetryPolicy
 * @property {number} backoffMs
 * @property {'escalate'|'fail'|'skip'} onExhaust
 *
 * @typedef {Object} VerificationStrategy
 * @property {'auto'|'human'|'hybrid'} type
 * @property {string[]=} checks
 * @property {number=} timeout
 *
 * @typedef {Object} VerificationResult
 * @property {boolean} passed
 * @property {Array<Object>} checks
 * @property {string} verifiedAt
 * @property {'agent'|'human'} verifiedBy
 *
 * @typedef {Object} BaseNode
 * @property {NodeType} type
 * @property {NodeStatus} status
 * @property {string[]} deps
 * @property {number=} estimateMinutes
 * @property {number=} actualMinutes
 * @property {string=} startedAt
 * @property {string=} completedAt
 * @property {string=} stage
 * @property {string=} lane
 *
 * @typedef {BaseNode & {
 *   type: 'work',
 *   title?: string,
 *   description?: string,
 *   attempts?: number,
 *   maxAttempts?: number,
 *   retryPolicy?: RetryPolicy,
 *   output?: Record<string, unknown>,
 *   error?: string
 * }} WorkNode
 *
 * @typedef {BaseNode & {
 *   type: 'gate',
 *   gateType?: string,
 *   required?: boolean,
 *   verificationStrategy?: VerificationStrategy,
 *   verificationResult?: VerificationResult,
 *   error?: string
 * }} GateNode
 *
 * @typedef {BaseNode & { type: 'fork' }} ForkNode
 *
 * @typedef {BaseNode & {
 *   type: 'join',
 *   joinStrategy?: 'all'|'any'|'n_of_m',
 *   requiredCount?: number
 * }} JoinNode
 *
 * @typedef {BaseNode & {
 *   type: 'conditional',
 *   condition: { expression: string, inputFrom: string },
 *   thenBranch?: string[],
 *   elseBranch?: string[],
 *   evaluatedTo?: 'then'|'else'
 * }} ConditionalNode
 *
 * @typedef {WorkNode | GateNode | ForkNode | JoinNode | ConditionalNode} GraphNode
 *
 * @typedef {Object} Edge
 * @property {string} from
 * @property {string} to
 * @property {EdgeType=} type
 * @property {EdgeCondition=} condition
 * @property {Array<{ sourceField: string, targetField: string }>=} dataMapping
 *
 * @typedef {Object} ExecutionPolicy
 * @property {number=} replanBudgetRemaining
 * @property {number=} replanBudgetInitial
 * @property {number=} verifyBudgetRemaining
 * @property {number=} verifyBudgetInitial
 * @property {number=} maxConcurrentAutoChecks
 * @property {boolean=} immutableRequiredGates
 * @property {number=} maxConcurrent
 * @property {PriorityMode=} priorityMode
 * @property {number=} nodeTimeoutMs
 * @property {number=} graphTimeoutMs
 *
 * @typedef {Object} DoneCriteria
 * @property {boolean=} allRequiredGatesPassed
 * @property {boolean=} noRunnableOrPendingWork
 * @property {string[]=} completionSinkNodeIds
 * @property {string[]=} customCriteria
 *
 * @typedef {Object} GraphEvent
 * @property {'graph_created'|'node_status'|'gate_verification'|'budget_consumed'|'replan'} eventType
 * @property {string=} graphId
 * @property {string} timestamp
 * @property {string=} nodeId
 * @property {NodeStatus=} fromStatus
 * @property {NodeStatus=} toStatus
 * @property {string=} reason
 * @property {'replan'|'verify'=} budgetType
 * @property {number=} remaining
 * @property {string=} triggerNodeId
 *
 * @typedef {Object} ExecutionGraph
 * @property {string} id
 * @property {string} taskId
 * @property {number} graphVersion
 * @property {GraphMode} mode
 * @property {Record<string, GraphNode>} nodes
 * @property {Edge[]} edges
 * @property {ExecutionPolicy} policy
 * @property {DoneCriteria} doneCriteria
 * @property {GraphEvent[]=} runtimeEvents
 * @property {Array<Record<string, unknown>>=} versionHistory
 * @property {string=} createdAt
 * @property {string=} updatedAt
 * @property {string=} startedAt
 * @property {string=} completedAt
 * @property {string=} timedOutAt
 * @property {string=} status
 */

function isTerminalStatus(status) {
    return TERMINAL_NODE_STATUSES.includes(status);
}

function isIncompleteStatus(status) {
    return INCOMPLETE_FOR_DONE_STATUSES.includes(status);
}

module.exports = {
    DEFAULT_EXECUTION_POLICY,
    TERMINAL_NODE_STATUSES,
    SUCCESS_NODE_STATUSES,
    FAILURE_NODE_STATUSES,
    SOFT_DEP_SATISFIED_STATUSES,
    INCOMPLETE_FOR_DONE_STATUSES,
    isTerminalStatus,
    isIncompleteStatus,
};
