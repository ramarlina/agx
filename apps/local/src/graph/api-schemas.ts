import { z } from "zod";

const isoTimestampSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO timestamp",
  });

const nonEmptyStringSchema = z.string().trim().min(1);

export const GraphModeSchema = z.enum(["SIMPLE", "PROJECT"]);
export const NodeTypeSchema = z.enum(["work", "gate", "fork", "join", "conditional", "root", "function"]);
export const NodeStatusSchema = z.enum([
  "pending",
  "running",
  "awaiting_human",
  "done",
  "passed",
  "failed",
  "blocked",
  "skipped",
  "paused",
  "stopped",
]);
export const GateTypeSchema = z.enum([
  "progress",
  "quality_gate",
  "design_gate",
  "handoff_gate",
  "approval_gate",
]);
export const PriorityModeSchema = z.enum(["fifo", "critical_path", "shortest_first"]);

export const NodeMetricsSchema = z.object({
  tokensUsed: z.number(),
  latencyMs: z.number(),
  retryCount: z.number(),
  errorMessages: z.array(z.string()).optional(),
});

const RetryPolicySchema = z.object({
  backoffMs: z.number(),
  onExhaust: z.enum(["escalate", "fail", "skip"]),
});

export const NodeCommentSchema = z.object({
  id: nonEmptyStringSchema,
  content: nonEmptyStringSchema,
  author: nonEmptyStringSchema,
  createdAt: isoTimestampSchema,
});

export const AddNodeCommentRequestSchema = z.object({
  content: z.string().trim().min(1, "Comment content is required"),
});

const BaseNodeSchema = z.object({
  type: NodeTypeSchema,
  status: NodeStatusSchema,
  deps: z.array(z.string()),
  estimateMinutes: z.number().optional(),
  actualMinutes: z.number().optional(),
  startedAt: isoTimestampSchema.optional(),
  completedAt: isoTimestampSchema.nullable().optional(),
  stage: z.string().optional(),
  lane: z.string().optional(),
  metrics: NodeMetricsSchema.optional(),
  comments: z.array(NodeCommentSchema).optional(),
});

const CheckResultSchema = z.object({
  check: nonEmptyStringSchema,
  passed: z.boolean(),
  message: z.string().optional(),
  latencyMs: z.number().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

const VerificationStrategySchema = z.object({
  type: z.enum(["auto", "human", "hybrid"]),
  checks: z.array(z.string()).optional(),
  timeout: z.number().optional(),
});

const VerificationResultSchema = z.object({
  passed: z.boolean(),
  checks: z.array(CheckResultSchema),
  verifiedAt: isoTimestampSchema,
  verifiedBy: z.enum(["agent", "human"]),
});

const WorkNodeSchema = BaseNodeSchema.extend({
  type: z.literal("work"),
  status: z.enum(["pending", "running", "done", "failed", "blocked", "skipped", "paused", "stopped"]),
  workType: z.enum(["implementation", "spike"]).optional(),
  title: nonEmptyStringSchema,
  description: z.string().optional(),
  where: z.array(z.string()).optional(),
  whatChanges: z.array(z.string()).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  todos: z.array(z.string()).optional(),
  verification: z.array(z.string()).optional(),
  generatedByPlanNodeId: z.string().optional(),
  planNodeKey: z.string().optional(),
  attempts: z.number(),
  maxAttempts: z.number(),
  retryPolicy: RetryPolicySchema,
  output: z.record(z.string(), z.unknown()).optional(),
});

const GateNodeSchema = BaseNodeSchema.extend({
  type: z.literal("gate"),
  status: z.enum(["pending", "running", "awaiting_human", "passed", "failed", "skipped", "paused", "stopped"]),
  gateType: GateTypeSchema,
  required: z.boolean(),
  verificationStrategy: VerificationStrategySchema,
  verificationResult: VerificationResultSchema.optional(),
});

const RootNodeSchema = BaseNodeSchema.extend({
  type: z.literal("root"),
  status: NodeStatusSchema,
  title: nonEmptyStringSchema,
  objective: z.string(),
  criteria: z.array(z.string()).optional(),
  graphCreated: z.boolean(),
  planVersions: z.array(z.number()).optional(),
});

const ForkNodeSchema = BaseNodeSchema.extend({
  type: z.literal("fork"),
  status: z.enum(["pending", "done", "skipped"]),
});

const JoinNodeSchema = BaseNodeSchema.extend({
  type: z.literal("join"),
  status: z.enum(["pending", "running", "done", "failed", "skipped", "paused", "stopped"]),
  joinStrategy: z.enum(["all", "any", "n_of_m"]),
  requiredCount: z.number().optional(),
});

const ConditionalNodeSchema = BaseNodeSchema.extend({
  type: z.literal("conditional"),
  status: z.enum(["pending", "running", "done", "failed", "skipped", "paused", "stopped"]),
  condition: z.object({
    expression: nonEmptyStringSchema,
    inputFrom: nonEmptyStringSchema,
  }),
  thenBranch: z.array(z.string()),
  elseBranch: z.array(z.string()),
  evaluatedTo: z.enum(["then", "else"]).optional(),
});

const FunctionNodeSchema = BaseNodeSchema.extend({
  type: z.literal("function"),
  status: z.enum(["pending", "running", "done", "failed", "skipped"]),
  kind: z.enum(["bash", "mcp", "internal"]),
  title: nonEmptyStringSchema,
  description: z.string().optional(),
  command: nonEmptyStringSchema,
  args: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z.number().optional(),
  output: z.record(z.string(), z.unknown()).optional(),
});

export const GraphNodeSchema = z.discriminatedUnion("type", [
  RootNodeSchema,
  WorkNodeSchema,
  GateNodeSchema,
  ForkNodeSchema,
  JoinNodeSchema,
  ConditionalNodeSchema,
  FunctionNodeSchema,
]);

export const EdgeSchema = z.object({
  from: nonEmptyStringSchema,
  to: nonEmptyStringSchema,
  type: z.enum(["hard", "soft"]),
  condition: z.enum(["on_success", "on_failure", "always"]).optional(),
  dataMapping: z
    .array(
      z.object({
        sourceField: nonEmptyStringSchema,
        targetField: nonEmptyStringSchema,
      }),
    )
    .optional(),
});

export const ExecutionPolicySchema = z.object({
  replanBudgetRemaining: z.number(),
  replanBudgetInitial: z.number(),
  verifyBudgetRemaining: z.number(),
  verifyBudgetInitial: z.number(),
  maxConcurrentAutoChecks: z.number(),
  immutableRequiredGates: z.boolean(),
  maxConcurrent: z.number(),
  priorityMode: PriorityModeSchema,
  nodeTimeoutMs: z.number(),
  graphTimeoutMs: z.number(),
});

export const DoneCriteriaSchema = z.object({
  allRequiredGatesPassed: z.boolean(),
  noRunnableOrPendingWork: z.boolean(),
  completionSinkNodeIds: z.array(z.string()).optional(),
  customCriteria: z.array(z.string()).optional(),
});

const GraphEventAuditContextSchema = z.object({
  actorId: nonEmptyStringSchema,
  actorType: z.enum(["user", "service", "system"]),
  action: z.enum([
    "graph_create",
    "graph_replan",
    "graph_rollback",
    "node_status_transition",
    "gate_verification",
    "budget_consumption",
  ]),
  projectId: z.string().optional(),
});

const ReplanEventSchema = z.object({
  eventType: z.literal("replan"),
  fromVersion: z.number(),
  toVersion: z.number(),
  timestamp: isoTimestampSchema,
  reason: nonEmptyStringSchema,
  triggeredBy: z.enum(["agent", "human"]),
  triggeredAtNodeId: nonEmptyStringSchema,
  changes: z.object({
    addedNodes: z.array(z.string()),
    removedNodes: z.array(z.string()),
    rewiredDeps: z.array(z.string()),
    estimateDeltas: z.record(z.string(), z.number()),
  }),
  audit: GraphEventAuditContextSchema.optional(),
});

const RollbackEventSchema = z.object({
  eventType: z.literal("rollback"),
  toCheckpoint: nonEmptyStringSchema,
  timestamp: isoTimestampSchema,
  reason: nonEmptyStringSchema,
  triggeredBy: z.enum(["agent", "human"]),
  audit: GraphEventAuditContextSchema.optional(),
});

const GraphCreatedEventSchema = z.object({
  eventType: z.literal("graph_created"),
  timestamp: isoTimestampSchema,
  mode: GraphModeSchema,
  nodeCount: z.number(),
  edgeCount: z.number(),
  audit: GraphEventAuditContextSchema.optional(),
});

const NodeStatusEventSchema = z.object({
  eventType: z.literal("node_status"),
  nodeId: nonEmptyStringSchema,
  fromStatus: NodeStatusSchema,
  toStatus: NodeStatusSchema,
  timestamp: isoTimestampSchema,
  reason: z.string().optional(),
  audit: GraphEventAuditContextSchema.optional(),
});

const GateVerificationEventSchema = z.object({
  eventType: z.literal("gate_verification"),
  nodeId: nonEmptyStringSchema,
  timestamp: isoTimestampSchema,
  result: VerificationResultSchema,
  audit: GraphEventAuditContextSchema.optional(),
});

const BudgetConsumedEventSchema = z.object({
  eventType: z.literal("budget_consumed"),
  budgetType: z.enum(["replan", "verify"]),
  remaining: z.number(),
  timestamp: isoTimestampSchema,
  triggerNodeId: nonEmptyStringSchema,
  audit: GraphEventAuditContextSchema.optional(),
});

const VersionHistoryEventSchema = z.union([ReplanEventSchema, RollbackEventSchema]);
const RuntimeEventSchema = z.union([
  GraphCreatedEventSchema,
  NodeStatusEventSchema,
  GateVerificationEventSchema,
  BudgetConsumedEventSchema,
]);

export const GraphScheduleSchema = z.object({
  intervalMs: z.number().int().positive(),
  state: z.enum(["active", "paused", "stopped"]),
  resetNodeIds: z.array(z.string()),
  maxRuns: z.number().int().positive().optional(),
  runCount: z.number().int().nonnegative(),
  lastTickAt: z.number().optional(),
  tickInProgress: z.boolean(),
  maxConcurrency: z.number().int().optional(),
  currentConcurrency: z.number().int().optional(),
  createdAt: isoTimestampSchema,
  activeUntil: isoTimestampSchema.optional(),
  rootMessageId: nonEmptyStringSchema.optional(),
});

export const ExecutionGraphSchema = z.object({
  id: nonEmptyStringSchema,
  taskId: nonEmptyStringSchema,
  graphVersion: z.number(),
  mode: GraphModeSchema,
  nodes: z.record(z.string(), GraphNodeSchema),
  edges: z.array(EdgeSchema),
  policy: ExecutionPolicySchema,
  doneCriteria: DoneCriteriaSchema,
  schedule: GraphScheduleSchema.optional(),
  versionHistory: z.array(VersionHistoryEventSchema),
  runtimeEvents: z.array(RuntimeEventSchema).optional(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

const GraphNodePartialInputSchema = z
  .object({
    type: NodeTypeSchema.optional(),
    status: NodeStatusSchema.optional(),
    deps: z.array(z.string()).optional(),
    estimateMinutes: z.number().optional(),
    actualMinutes: z.number().optional(),
    startedAt: isoTimestampSchema.optional(),
    completedAt: isoTimestampSchema.nullable().optional(),
    stage: z.string().optional(),
    lane: z.string().optional(),
    metrics: NodeMetricsSchema.optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    workType: z.enum(["implementation", "spike"]).optional(),
    where: z.array(z.string()).optional(),
    whatChanges: z.array(z.string()).optional(),
    acceptanceCriteria: z.array(z.string()).optional(),
    todos: z.array(z.string()).optional(),
    verification: z.array(z.string()).optional(),
    generatedByPlanNodeId: z.string().optional(),
    planNodeKey: z.string().optional(),
    attempts: z.number().optional(),
    maxAttempts: z.number().optional(),
    retryPolicy: RetryPolicySchema.partial().optional(),
    output: z.record(z.string(), z.unknown()).optional(),
    gateType: GateTypeSchema.optional(),
    required: z.boolean().optional(),
    verificationStrategy: VerificationStrategySchema.partial().optional(),
    verificationResult: VerificationResultSchema.optional(),
    joinStrategy: z.enum(["all", "any", "n_of_m"]).optional(),
    requiredCount: z.number().optional(),
    condition: z
      .object({
        expression: z.string().optional(),
        inputFrom: z.string().optional(),
      })
      .optional(),
    thenBranch: z.array(z.string()).optional(),
    elseBranch: z.array(z.string()).optional(),
    evaluatedTo: z.enum(["then", "else"]).optional(),
    // Function node fields
    kind: z.enum(["bash", "mcp", "internal"]).optional(),
    command: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    timeoutMs: z.number().optional(),
    // Root node fields
    objective: z.string().optional(),
    graphCreated: z.boolean().optional(),
    criteria: z.array(z.string()).optional(),
  })
  .passthrough();

export const CreateGraphRequestSchema = z.object({
  graph: ExecutionGraphSchema.optional(),
  mode: GraphModeSchema.optional(),
  nodes: z.record(z.string(), GraphNodePartialInputSchema).optional(),
  edges: z.array(EdgeSchema).optional(),
  policy: ExecutionPolicySchema.partial().optional(),
  doneCriteria: DoneCriteriaSchema.partial().optional(),
  schedule: GraphScheduleSchema.optional(),
  ifMatchGraphVersion: z.number().int().positive().optional(),
  projectId: nonEmptyStringSchema.optional(),
  project_id: nonEmptyStringSchema.optional(),
  migration: z.boolean().optional(),
});

const NodeRuntimePatchSchema = z.object({
  status: NodeStatusSchema.optional(),
  metrics: NodeMetricsSchema.optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  startedAt: isoTimestampSchema.optional(),
  completedAt: isoTimestampSchema.nullable().optional(),
  actualMinutes: z.number().optional(),
  configPatch: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateNodeRuntimeRequestSchema = z.object({
  ifMatchGraphVersion: z.number().int().positive(),
  nodeUpdates: z.record(z.string(), NodeRuntimePatchSchema),
  budgetUpdates: z
    .array(
      z.object({
        budgetType: z.enum(["replan", "verify"]),
        remaining: z.number(),
        triggerNodeId: nonEmptyStringSchema,
      }),
    )
    .optional(),
  projectId: nonEmptyStringSchema.optional(),
  project_id: nonEmptyStringSchema.optional(),
});

// Full graph replacement sent by daemon's persistGraphToCloud
export const DaemonGraphPatchRequestSchema = z.object({
  graph: ExecutionGraphSchema.optional(),
  graphId: nonEmptyStringSchema.optional(),
  mode: GraphModeSchema.optional(),
  nodes: z.record(z.string(), GraphNodeSchema.or(GraphNodePartialInputSchema)).optional(),
  edges: z.array(EdgeSchema).optional(),
  policy: ExecutionPolicySchema.partial().optional(),
  doneCriteria: DoneCriteriaSchema.partial().optional(),
  schedule: GraphScheduleSchema.optional(),
  runtimeEvents: z.array(RuntimeEventSchema).optional(),
  status: z.string().optional(),
  startedAt: isoTimestampSchema.optional(),
  completedAt: isoTimestampSchema.nullable().optional(),
  timedOutAt: isoTimestampSchema.optional(),
  ifMatchGraphVersion: z.number().int().positive().optional(),
  projectId: nonEmptyStringSchema.optional(),
  project_id: nonEmptyStringSchema.optional(),
}).passthrough();

// Union: either daemon full-graph patch or node-runtime patch
export const GraphPatchRequestSchema = z.union([
  UpdateNodeRuntimeRequestSchema,
  DaemonGraphPatchRequestSchema,
]);

export const ReplanRequestSchema = z.object({
  ifMatchGraphVersion: z.number().int().positive(),
  triggeredAtNodeId: nonEmptyStringSchema,
  reason: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema.optional(),
  project_id: nonEmptyStringSchema.optional(),
  proposedChanges: z
    .object({
      addNodes: z.record(z.string(), GraphNodePartialInputSchema).optional(),
      removeNodes: z.array(z.string()).optional(),
      rewireEdges: z.array(EdgeSchema).optional(),
      estimateDeltas: z.record(z.string(), z.number()).optional(),
    })
    .optional(),
});

export const RollbackRequestSchema = z.object({
  ifMatchGraphVersion: z.number().int().positive(),
  toCheckpoint: nonEmptyStringSchema,
  reason: z.string().optional(),
  projectId: nonEmptyStringSchema.optional(),
  project_id: nonEmptyStringSchema.optional(),
});

export const StartNodeRequestSchema = z.object({
  ifMatchGraphVersion: z.number().int().positive(),
  startedAt: isoTimestampSchema.optional(),
  projectId: nonEmptyStringSchema.optional(),
  project_id: nonEmptyStringSchema.optional(),
});

export const CompleteNodeRequestSchema = z.object({
  ifMatchGraphVersion: z.number().int().positive(),
  output: z.record(z.string(), z.unknown()).optional(),
  metrics: NodeMetricsSchema.optional(),
  completedAt: isoTimestampSchema.nullable().optional(),
  actualMinutes: z.number().optional(),
  projectId: nonEmptyStringSchema.optional(),
  project_id: nonEmptyStringSchema.optional(),
});

export const FailNodeRequestSchema = z.object({
  ifMatchGraphVersion: z.number().int().positive(),
  error: nonEmptyStringSchema,
  retry: z.boolean().optional(),
  metrics: NodeMetricsSchema.optional(),
  completedAt: isoTimestampSchema.nullable().optional(),
  projectId: nonEmptyStringSchema.optional(),
  project_id: nonEmptyStringSchema.optional(),
});

export const VerifyGateRequestSchema = z.object({
  ifMatchGraphVersion: z.number().int().positive(),
  approved: z.boolean(),
  feedback: z.string().optional(),
  checks: z.array(CheckResultSchema).optional(),
  completedAt: isoTimestampSchema.nullable().optional(),
  projectId: nonEmptyStringSchema.optional(),
  project_id: nonEmptyStringSchema.optional(),
});

export const GraphEnvelopeResponseSchema = z.object({
  graph: ExecutionGraphSchema,
});

export const NodeMutationResponseSchema = z.object({
  graphId: nonEmptyStringSchema,
  nodeId: nonEmptyStringSchema,
  graphVersion: z.number(),
  updatedAt: isoTimestampSchema,
});

export const GraphUpdateResponseSchema = z.object({
  update: z.object({
    graphVersion: z.number(),
    updatedAt: isoTimestampSchema,
  }),
});

export const ConflictResponseSchema = z.object({
  error: nonEmptyStringSchema,
  expectedVersion: z.number(),
  actualVersion: z.number(),
  currentGraphVersion: z.number(),
});

export const GraphHistoryEntrySchema = z.object({
  version: z.number(),
  eventType: z.enum(["replan", "rollback"]),
  timestamp: isoTimestampSchema,
  reason: nonEmptyStringSchema,
  triggeredBy: z.enum(["agent", "human"]),
  diff: z.object({
    addedNodes: z.array(z.string()),
    removedNodes: z.array(z.string()),
    rewiredDeps: z.array(z.string()),
    estimateDeltas: z.record(z.string(), z.number()),
  }),
  checkpointNodeId: z.string().optional(),
});

export const GraphHistoryResponseSchema = z.object({
  graphId: nonEmptyStringSchema,
  taskId: nonEmptyStringSchema,
  currentGraphVersion: z.number(),
  history: z.array(GraphHistoryEntrySchema),
});

export const GraphMetricsSchema = z.object({
  totalNodes: z.number(),
  completedNodes: z.number(),
  failedNodes: z.number(),
  totalTokensUsed: z.number(),
  totalLatencyMs: z.number(),
  estimatedMinutes: z.number(),
  actualMinutes: z.number(),
  replanCount: z.number(),
  gatePassRate: z.number(),
});

export const GraphMetricsResponseSchema = z.object({
  graphId: nonEmptyStringSchema,
  taskId: nonEmptyStringSchema,
  currentGraphVersion: z.number(),
  metrics: GraphMetricsSchema,
});

export const ErrorResponseSchema = z.object({
  error: nonEmptyStringSchema,
});

export type CreateGraphRequest = z.infer<typeof CreateGraphRequestSchema>;
export type ReplanRequest = z.infer<typeof ReplanRequestSchema>;
export type UpdateNodeRuntimeRequest = z.infer<typeof UpdateNodeRuntimeRequestSchema>;
export type CompleteNodeRequest = z.infer<typeof CompleteNodeRequestSchema>;
export type FailNodeRequest = z.infer<typeof FailNodeRequestSchema>;
export type VerifyGateRequest = z.infer<typeof VerifyGateRequestSchema>;
export type RollbackRequest = z.infer<typeof RollbackRequestSchema>;
