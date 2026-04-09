export type GraphMode = 'SIMPLE' | 'PROJECT';

export type NodeType = 'work' | 'gate' | 'fork' | 'join' | 'conditional' | 'root' | 'function';

export type NodeStatus =
  | 'pending'
  | 'running'
  | 'awaiting_human'
  | 'done'
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'skipped'
  | 'paused'
  | 'stopped';

export type TerminalNodeStatus = Extract<NodeStatus, 'done' | 'passed' | 'failed' | 'skipped'>;
export type SuccessNodeStatus = Extract<NodeStatus, 'done' | 'passed'>;
export type FailureNodeStatus = Extract<NodeStatus, 'failed'>;
export type SoftDepSatisfiedStatus = Extract<NodeStatus, 'done' | 'passed' | 'failed' | 'skipped' | 'blocked'>;
export type IncompleteForDoneStatus = Extract<NodeStatus, 'pending' | 'running' | 'awaiting_human' | 'blocked'>;

export type GateType =
  | 'progress'
  | 'quality_gate'
  | 'design_gate'
  | 'handoff_gate'
  | 'approval_gate';

export type FunctionNodeKind = 'bash' | 'mcp' | 'internal';

export type FunctionNodeStatus = Extract<NodeStatus, 'pending' | 'running' | 'done' | 'failed' | 'skipped'>;

export type WorkNodeStatus = Extract<NodeStatus, 'pending' | 'running' | 'done' | 'failed' | 'blocked' | 'skipped' | 'paused' | 'stopped'>;
export type GateNodeStatus = Extract<NodeStatus, 'pending' | 'running' | 'awaiting_human' | 'passed' | 'failed' | 'skipped' | 'paused' | 'stopped'>;
export type ForkNodeStatus = Extract<NodeStatus, 'pending' | 'done' | 'skipped'>;
export type JoinNodeStatus = Extract<NodeStatus, 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'paused' | 'stopped'>;
export type ConditionalNodeStatus = Extract<NodeStatus, 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'paused' | 'stopped'>;

// Execution lifecycle states for the entire task
export type ExecutionLifecycleState = 'ready' | 'running' | 'paused' | 'stopped' | 'done';

export interface NodeMetrics {
  tokensUsed: number;
  latencyMs: number;
  retryCount: number;
  errorMessages?: string[];
}

export interface NodeComment {
  id: string;
  content: string;
  author: string;
  createdAt: string;
}

export interface BaseNode {
  type: NodeType;
  status: NodeStatus;
  deps: string[];

  estimateMinutes?: number;
  actualMinutes?: number;
  startedAt?: string;
  completedAt?: string;

  stage?: string;
  lane?: string;

  metrics?: NodeMetrics;
  comments?: NodeComment[];
}

export interface RetryPolicy {
  backoffMs: number;
  onExhaust: 'escalate' | 'fail' | 'skip';
}

export interface WorkNode extends BaseNode {
  type: 'work';
  status: WorkNodeStatus;
  workType?: 'implementation' | 'spike';

  title: string;
  description?: string;
  where?: string[];
  whatChanges?: string[];
  acceptanceCriteria?: string[];
  todos?: string[];
  verification?: string[];
  generatedByPlanNodeId?: string;
  planNodeKey?: string;

  attempts: number;
  maxAttempts: number;
  retryPolicy: RetryPolicy;

  output?: Record<string, unknown>;
}

export interface FunctionNode extends BaseNode {
  type: 'function';
  status: FunctionNodeStatus;
  kind: FunctionNodeKind;

  title: string;
  description?: string;

  /** For bash/internal: the command string. For mcp: the tool name. */
  command: string;
  /** For mcp/internal: tool or command input parameters. */
  args?: Record<string, unknown>;

  timeoutMs?: number;

  output?: Record<string, unknown>;
}

// Root node represents the task objective and creates the graph on first execution
export interface RootNode extends BaseNode {
  type: 'root';
  status: NodeStatus;

  title: string;
  objective: string;
  criteria?: string[];
  
  // True if the graph has been created (planned)
  graphCreated: boolean;
  
  // Version history for replanning
  planVersions?: number[];
}

export interface CheckResult {
  check: string;
  passed: boolean;
  message?: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

export interface VerificationStrategy {
  type: 'auto' | 'human' | 'hybrid';
  checks?: string[];
  timeout?: number;
}

export interface VerificationResult {
  passed: boolean;
  checks: CheckResult[];
  verifiedAt: string;
  verifiedBy: 'agent' | 'human';
}

export interface GateNode extends BaseNode {
  type: 'gate';
  status: GateNodeStatus;

  gateType: GateType;
  required: boolean;

  verificationStrategy: VerificationStrategy;
  verificationResult?: VerificationResult;
}

export interface ForkNode extends BaseNode {
  type: 'fork';
  status: ForkNodeStatus;
}

export interface JoinNode extends BaseNode {
  type: 'join';
  status: JoinNodeStatus;

  joinStrategy: 'all' | 'any' | 'n_of_m';
  requiredCount?: number;
}

export interface ConditionalNode extends BaseNode {
  type: 'conditional';
  status: ConditionalNodeStatus;

  condition: {
    expression: string;
    inputFrom: string;
  };

  thenBranch: string[];
  elseBranch: string[];

  evaluatedTo?: 'then' | 'else';
}

export type GraphNode = WorkNode | GateNode | ForkNode | JoinNode | ConditionalNode | RootNode | FunctionNode;

export type EdgeType = 'hard' | 'soft';
export type EdgeCondition = 'on_success' | 'on_failure' | 'always';

export interface EdgeDataMapping {
  sourceField: string;
  targetField: string;
}

export interface Edge {
  from: string;
  to: string;

  type: EdgeType;
  condition?: EdgeCondition;

  dataMapping?: EdgeDataMapping[];
}

export type PriorityMode = 'fifo' | 'critical_path' | 'shortest_first';

export interface ExecutionPolicy {
  replanBudgetRemaining: number;
  replanBudgetInitial: number;

  verifyBudgetRemaining: number;
  verifyBudgetInitial: number;
  maxConcurrentAutoChecks: number;

  immutableRequiredGates: boolean;

  maxConcurrent: number;
  priorityMode: PriorityMode;

  nodeTimeoutMs: number;
  graphTimeoutMs: number;
}

export interface DoneCriteria {
  allRequiredGatesPassed: boolean;
  noRunnableOrPendingWork: boolean;
  completionSinkNodeIds?: string[];
  customCriteria?: string[];
}

export type GraphAuditActorType = 'user' | 'service' | 'system';

export type GraphAuditAction =
  | 'graph_create'
  | 'graph_replan'
  | 'graph_rollback'
  | 'node_status_transition'
  | 'gate_verification'
  | 'budget_consumption';

export interface GraphEventAuditContext {
  actorId: string;
  actorType: GraphAuditActorType;
  action: GraphAuditAction;
  projectId?: string;
}

export interface GraphCreatedEvent {
  eventType: 'graph_created';
  timestamp: string;
  mode: GraphMode;
  nodeCount: number;
  edgeCount: number;
  audit?: GraphEventAuditContext;
}

export interface NodeStatusEvent {
  eventType: 'node_status';
  nodeId: string;
  fromStatus: NodeStatus;
  toStatus: NodeStatus;
  timestamp: string;
  reason?: string;
  audit?: GraphEventAuditContext;
}

export interface GateVerificationEvent {
  eventType: 'gate_verification';
  nodeId: string;
  timestamp: string;
  result: VerificationResult;
  audit?: GraphEventAuditContext;
}

export interface BudgetConsumedEvent {
  eventType: 'budget_consumed';
  budgetType: 'replan' | 'verify';
  remaining: number;
  timestamp: string;
  triggerNodeId: string;
  audit?: GraphEventAuditContext;
}

export interface ReplanEvent {
  eventType: 'replan';
  fromVersion: number;
  toVersion: number;
  timestamp: string;
  reason: string;
  triggeredBy: 'agent' | 'human';
  triggeredAtNodeId: string;

  changes: {
    addedNodes: string[];
    removedNodes: string[];
    rewiredDeps: string[];
    estimateDeltas: Record<string, number>;
  };
  audit?: GraphEventAuditContext;
}

export interface RollbackEvent {
  eventType: 'rollback';
  toCheckpoint: string;
  timestamp: string;
  reason: string;
  triggeredBy: 'agent' | 'human';
  audit?: GraphEventAuditContext;
}

export type VersionHistoryEvent = ReplanEvent | RollbackEvent;
export type RuntimeEvent = GraphCreatedEvent | NodeStatusEvent | GateVerificationEvent | BudgetConsumedEvent;
export type GraphEvent = VersionHistoryEvent | RuntimeEvent;

export type ScheduleState = 'active' | 'paused' | 'stopped';

export interface GraphSchedule {
  /** Interval between ticks in milliseconds (used when cronExpr is absent) */
  intervalMs: number;
  /** Optional cron expression — takes precedence over intervalMs when present */
  cronExpr?: string;
  /** Human-readable cadence label (e.g. "Every 2 hours", "Weekdays at 9 AM") */
  cadence?: string;
  /** Current schedule state */
  state: ScheduleState;
  /** Node IDs to reset to pending on each tick */
  resetNodeIds: string[];
  /** Maximum number of runs (undefined = unlimited) */
  maxRuns?: number;
  /** Number of completed runs so far */
  runCount: number;
  /** Timestamp of last tick start (epoch ms) */
  lastTickAt?: number;
  /** Pre-computed next tick timestamp (epoch ms) — set after each tick or activation */
  nextTickAt?: number;
  /** Whether a tick is currently executing (overlap prevention) */
  tickInProgress: boolean;
  /** ISO timestamp when schedule was created */
  createdAt: string;
  /** Optional timestamp after which schedule should stop running */
  activeUntil?: string;
  /** Optional root message id this schedule monitors */
  rootMessageId?: string;
  /** Consecutive failure count (for auto-pause) */
  consecutiveFailures?: number;
  /** Max consecutive failures before auto-pause (undefined = no limit) */
  maxConsecutiveFailures?: number;
  /** Optional display name for the schedule */
  name?: string;
  /** Optional description */
  description?: string;
}

export interface ExecutionGraph {
  id: string;
  taskId: string;
  graphVersion: number;

  mode: GraphMode;

  // Execution lifecycle state for the entire task (defaults to 'ready' if not set)
  executionState?: ExecutionLifecycleState;

  nodes: Record<string, GraphNode>;
  edges: Edge[];

  policy: ExecutionPolicy;

  doneCriteria: DoneCriteria;

  /** Optional recurrence schedule for autonomous re-execution */
  schedule?: GraphSchedule;

  versionHistory: VersionHistoryEvent[];
  runtimeEvents?: RuntimeEvent[];

  createdAt: string;
  updatedAt: string;
}
