/* eslint-disable no-console */
'use strict';

const os = require('os');
const { tick: schedulerTick } = require('../../graph/scheduler');
const { DEFAULT_EXECUTION_POLICY, INCOMPLETE_FOR_DONE_STATUSES } = require('../../graph/types');
const { runVerifyGate } = require('../../verify-gate');

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

const VALID_NODE_STATUSES = new Set([
  'pending',
  'running',
  'awaiting_human',
  'done',
  'passed',
  'failed',
  'blocked',
  'skipped',
]);

const VALID_EDGE_CONDITIONS = new Set(['on_success', 'on_failure', 'always']);

function normalizeNodeStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return 'pending';
  if (VALID_NODE_STATUSES.has(normalized)) return normalized;
  return normalized;
}

function normalizeNodeType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (!normalized) return 'work';
  if (normalized === 'spike') return 'work';
  if (normalized === 'work' || normalized === 'gate' || normalized === 'root' || normalized === 'fork' || normalized === 'join' || normalized === 'conditional') {
    return normalized;
  }
  return normalized;
}

function normalizeEdgeType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  return normalized === 'soft' ? 'soft' : 'hard';
}

function normalizeEdgeCondition(condition) {
  const normalized = String(condition || '').trim().toLowerCase();
  if (!normalized) return 'on_success';
  return VALID_EDGE_CONDITIONS.has(normalized) ? normalized : 'on_success';
}

function normalizeGraphExecutionFields(graph) {
  if (!asObject(graph?.nodes)) graph.nodes = {};
  if (!Array.isArray(graph?.edges)) graph.edges = [];

  for (const [nodeId, rawNode] of Object.entries(graph.nodes)) {
    const node = asObject(rawNode);
    if (!node) continue;
    node.type = normalizeNodeType(node.type);
    node.status = normalizeNodeStatus(node.status);
    if (typeof node.gateType === 'string') {
      node.gateType = node.gateType.trim().toLowerCase();
    }
    if (asObject(node.verificationStrategy) && typeof node.verificationStrategy.type === 'string') {
      node.verificationStrategy.type = node.verificationStrategy.type.trim().toLowerCase();
    }
    if (Array.isArray(node.deps)) {
      node.deps = Array.from(new Set(
        node.deps.map((dep) => String(dep || '').trim()).filter((dep) => dep && dep !== nodeId)
      ));
    } else {
      node.deps = [];
    }
  }

  graph.edges = graph.edges
    .filter((edge) => asObject(edge))
    .map((edge) => ({
      ...edge,
      from: String(edge.from || '').trim(),
      to: String(edge.to || '').trim(),
      type: normalizeEdgeType(edge.type),
      condition: normalizeEdgeCondition(edge.condition),
    }))
    .filter((edge) => edge.from && edge.to && graph.nodes[edge.from] && graph.nodes[edge.to]);

  if (asObject(graph.doneCriteria) && Array.isArray(graph.doneCriteria.completionSinkNodeIds)) {
    graph.doneCriteria.completionSinkNodeIds = Array.from(new Set(
      graph.doneCriteria.completionSinkNodeIds
        .map((id) => String(id || '').trim())
        .filter((id) => id && graph.nodes[id])
    ));
  }
}

function parseFrontmatterFromContent(content) {
  if (!content) return {};
  const text = String(content);
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) frontmatter[key] = value;
  }
  return frontmatter;
}

function normalizeApprovalMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized === 'auto'
    || normalized === 'auto_approve'
    || normalized === 'auto-approve'
    || normalized === 'automatic'
  ) {
    return 'auto';
  }
  if (
    normalized === 'manual'
    || normalized === 'human'
    || normalized === 'require_approval'
    || normalized === 'require-approval'
  ) {
    return 'manual';
  }
  return null;
}

function resolveTaskApprovalMode(task) {
  const frontmatter = parseFrontmatterFromContent(task?.content || '');
  const candidates = [
    task?.approval_mode,
    task?.approvalMode,
    task?.approval,
    frontmatter.approval_mode,
    frontmatter.approval,
  ];
  for (const candidate of candidates) {
    const mode = normalizeApprovalMode(candidate);
    if (mode) return mode;
  }

  if (task?.auto_approve === true || task?.autoApprove === true) {
    return 'auto';
  }
  if (task?.auto_approve === false || task?.autoApprove === false) {
    return 'manual';
  }
  return 'manual';
}

function readEmbeddedGraph(task) {
  const candidates = [
    task?.execution_graph,
    task?.executionGraph,
    task?.graph,
  ];
  for (const candidate of candidates) {
    const obj = asObject(candidate);
    if (obj) return deepClone(obj);
  }
  return null;
}

function readGraphFromResponse(response) {
  if (!response) return null;
  if (asObject(response?.graph)) return deepClone(response.graph);
  if (asObject(response?.execution_graph)) return deepClone(response.execution_graph);
  if (asObject(response?.executionGraph)) return deepClone(response.executionGraph);
  if (asObject(response)) return deepClone(response);
  return null;
}

function normalizeGraph(graph, taskId) {
  const normalized = asObject(graph);
  if (!normalized) return null;

  if (!normalized.id && typeof normalized.graph_id === 'string' && normalized.graph_id.trim()) {
    normalized.id = normalized.graph_id.trim();
  }
  if (!normalized.taskId) normalized.taskId = taskId;
  if (!normalized.mode) normalized.mode = 'PROJECT';
  if (!Number.isInteger(normalized.graphVersion) || normalized.graphVersion < 1) {
    normalized.graphVersion = 1;
  }
  if (!asObject(normalized.policy)) normalized.policy = {};
  normalized.policy = { ...DEFAULT_EXECUTION_POLICY, ...normalized.policy };
  if (!asObject(normalized.doneCriteria)) {
    normalized.doneCriteria = {
      allRequiredGatesPassed: true,
      noRunnableOrPendingWork: true,
      completionSinkNodeIds: [],
      customCriteria: [],
    };
  }
  if (!asObject(normalized.nodes)) normalized.nodes = {};
  if (!Array.isArray(normalized.edges)) normalized.edges = [];
  if (!Array.isArray(normalized.runtimeEvents)) normalized.runtimeEvents = [];
  normalizeGraphExecutionFields(normalized);

  return normalized;
}

function assertGraphShape(graph, taskId) {
  if (!graph) throw new Error(`[v2-required] Task ${taskId} has no execution graph payload.`);
  if (typeof graph.id !== 'string' || !graph.id.trim()) {
    throw new Error(`[v2-required] Task ${taskId} graph is missing id.`);
  }
  if (!asObject(graph.nodes)) {
    throw new Error(`[v2-required] Task ${taskId} graph.nodes must be an object.`);
  }
  if (!Array.isArray(graph.edges)) {
    throw new Error(`[v2-required] Task ${taskId} graph.edges must be an array.`);
  }
}

function nodeStatusFingerprint(graph) {
  return Object.keys(graph.nodes || {})
    .sort()
    .map((nodeId) => `${nodeId}:${graph.nodes[nodeId]?.status || 'unknown'}`)
    .join('|');
}

function isNodeIncomplete(status) {
  return INCOMPLETE_FOR_DONE_STATUSES.includes(status);
}

function collectNodeIdsByStatus(graph, statuses) {
  const allowed = new Set(statuses);
  return Object.keys(graph.nodes || {}).filter((nodeId) => allowed.has(graph.nodes[nodeId]?.status));
}

function unresolvedPendingNodes(graph) {
  return collectNodeIdsByStatus(graph, ['pending', 'blocked', 'awaiting_human']);
}

function hasIncompleteNodes(graph) {
  return Object.values(graph.nodes || {}).some((node) => node && isNodeIncomplete(node.status));
}

function hasFailedNodes(graph) {
  return Object.values(graph.nodes || {}).some((node) => node && node.status === 'failed');
}

function allCompletionSinksPassed(graph) {
  const sinkIds = Array.isArray(graph?.doneCriteria?.completionSinkNodeIds)
    ? graph.doneCriteria.completionSinkNodeIds
    : [];
  if (sinkIds.length === 0) return !hasFailedNodes(graph);
  return sinkIds.every((nodeId) => {
    const status = graph.nodes?.[nodeId]?.status;
    return status === 'done' || status === 'passed';
  });
}

function isPlanNode(nodeId, node) {
  return nodeId === 'plan' || /generate.*execution.*plan/i.test(node?.title || '');
}

const LOCKED_PAST_PLAN_STATUSES = new Set(['done', 'passed', 'skipped']);
const TERMINAL_NODE_STATUSES = new Set(['done', 'passed', 'failed', 'skipped']);

function isTerminalStatus(status) {
  return TERMINAL_NODE_STATUSES.has(normalizeNodeStatus(status));
}

function collectPlanNodeIds(graph, planNodeId, previousDraftNodeIds = []) {
  const ids = new Set();
  for (const [nodeId, node] of Object.entries(graph?.nodes || {})) {
    if (node?.generatedByPlanNodeId === planNodeId) ids.add(nodeId);
  }
  for (const id of (Array.isArray(previousDraftNodeIds) ? previousDraftNodeIds : [])) {
    const normalized = String(id || '').trim();
    if (normalized && graph?.nodes?.[normalized]) ids.add(normalized);
  }
  return Array.from(ids);
}

function collectDescendantNodeIds(graph, startNodeId) {
  const start = String(startNodeId || '').trim();
  if (!start || !graph?.nodes?.[start]) return [];
  const adjacency = new Map();
  for (const edge of (Array.isArray(graph?.edges) ? graph.edges : [])) {
    const from = String(edge?.from || '').trim();
    const to = String(edge?.to || '').trim();
    if (!from || !to || !graph?.nodes?.[from] || !graph?.nodes?.[to]) continue;
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from).add(to);
  }

  const visited = new Set();
  const queue = [...(adjacency.get(start) || [])];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    const next = adjacency.get(nodeId);
    if (next) {
      for (const target of next) {
        if (!visited.has(target)) queue.push(target);
      }
    }
  }
  return Array.from(visited);
}

function resolveStartNodeId(task, graph) {
  const candidates = [
    task?.start_node_id,
    task?.startNodeId,
    task?.start_node,
    task?.startNode,
    task?.execution?.start_node_id,
    task?.execution?.startNodeId,
    task?.run_options?.start_node_id,
    task?.runOptions?.startNodeId,
    graph?.start_node_id,
    graph?.startNodeId,
    graph?.startNode,
  ];

  for (const candidate of candidates) {
    const nodeId = String(candidate || '').trim();
    if (nodeId && graph?.nodes?.[nodeId]) {
      return nodeId;
    }
  }

  return null;
}

function resetNodeForRerun(node) {
  if (!node || typeof node !== 'object') return;
  node.status = 'pending';
  node.startedAt = undefined;
  node.completedAt = undefined;
  node.error = undefined;
  if (node.type === 'work') {
    node.output = undefined;
    node.attempts = 0;
  }
  if (node.type === 'gate') {
    node.verificationResult = undefined;
    node.verifyFailures = undefined;
  }
}

function resetDownstreamApprovalGates(graph, startNodeId) {
  const resetGateIds = [];
  for (const nodeId of collectDescendantNodeIds(graph, startNodeId)) {
    const node = graph?.nodes?.[nodeId];
    if (!node || node.type !== 'gate') continue;
    const gateType = String(node.gateType || '').trim().toLowerCase();
    if (gateType !== 'approval_gate') continue;
    resetNodeForRerun(node);
    resetGateIds.push(nodeId);
  }
  return resetGateIds;
}

function applyStartNodeSelection(graph, task) {
  const startNodeId = resolveStartNodeId(task, graph);
  if (!startNodeId) {
    return { activeStartNodeId: null, wasWorkNodeRerun: false, resetApprovalGateIds: [] };
  }

  const node = graph?.nodes?.[startNodeId];
  if (!node) {
    return { activeStartNodeId: null, wasWorkNodeRerun: false, resetApprovalGateIds: [] };
  }

  const previousStatus = normalizeNodeStatus(node.status);
  const wasWorkNodeRerun = node.type === 'work' && (
    isTerminalStatus(previousStatus) || previousStatus === 'awaiting_human' || previousStatus === 'blocked'
  );

  if (wasWorkNodeRerun || previousStatus === 'failed') {
    resetNodeForRerun(node);
  }

  const resetApprovalGateIds = wasWorkNodeRerun
    ? resetDownstreamApprovalGates(graph, startNodeId)
    : [];

  return {
    activeStartNodeId: startNodeId,
    wasWorkNodeRerun,
    resetApprovalGateIds,
  };
}

function summarizePlanNodesForPrompt(graph, nodeIds) {
  const summaries = [];
  for (const nodeId of nodeIds) {
    const node = graph?.nodes?.[nodeId];
    if (!node) continue;
    summaries.push({
      id: nodeId,
      type: node.type,
      status: node.status,
      title: node.title || nodeId,
      deps: Array.isArray(node.deps) ? node.deps : [],
      workType: node.type === 'work' ? (node.workType || 'implementation') : undefined,
    });
  }
  return summaries;
}

function buildPlanReplanContext({
  graph,
  planNodeId,
  previousDraftNodeIds = [],
  anchorNodeId = 'plan-approval',
  preserveLockedPastNodes = true,
}) {
  const explicitPlanNodeIds = collectPlanNodeIds(graph, planNodeId, previousDraftNodeIds);
  const topoPlanNodeIds = collectDescendantNodeIds(graph, anchorNodeId)
    .filter((nodeId) => nodeId !== planNodeId && nodeId !== anchorNodeId);
  const planNodeIds = Array.from(new Set([...explicitPlanNodeIds, ...topoPlanNodeIds]));
  const lockedNodeIds = preserveLockedPastNodes
    ? planNodeIds.filter((nodeId) => LOCKED_PAST_PLAN_STATUSES.has(graph?.nodes?.[nodeId]?.status))
    : [];
  const lockedNodesById = {};
  for (const nodeId of lockedNodeIds) {
    lockedNodesById[nodeId] = deepClone(graph.nodes[nodeId]);
  }
  return {
    planNodeIds,
    lockedNodeIds,
    lockedNodesById,
    planNodeSummaries: summarizePlanNodesForPrompt(graph, planNodeIds),
  };
}

function normalizeWorkType(rawType, rawWorkType) {
  const type = String(rawType || '').trim().toLowerCase();
  const workType = String(rawWorkType || '').trim().toLowerCase();
  if (type === 'spike' || workType === 'spike') return 'spike';
  return 'implementation';
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(
    values
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
}

function resolveTaskPromptBody(task) {
  const description = String(task?.description || '').trim();
  if (description) return description;
  return String(task?.content || '').trim();
}

function isUiUxTask(task) {
  const title = String(task?.title || task?.goal || task?.user_request || '').toLowerCase();
  const body = resolveTaskPromptBody(task).toLowerCase();
  const text = `${title}\n${body}`;
  return /(ui|ux|frontend|front-end|interface|chat|component|design|accessibility|responsive)/.test(text);
}

function isArchitectureHeavyTask(task) {
  const title = String(task?.title || task?.goal || task?.user_request || '').toLowerCase();
  const body = resolveTaskPromptBody(task).toLowerCase();
  const text = `${title}\n${body}`;
  return /(architecture|system|backend|frontend|api|route|database|schema|table|repository|service layer|data flow|lifecycle|worker|celery|integration)/.test(text);
}

function buildPlanNodePrompt({ task, replanContext = null }) {
  const taskTitle = String(task?.title || task?.goal || task?.user_request || '').trim() || 'Untitled task';
  const taskContent = resolveTaskPromptBody(task);
  const uiUxRequired = isUiUxTask(task);
  const architectureRequired = isArchitectureHeavyTask(task);
  const hasExistingPlan = Array.isArray(replanContext?.planNodeIds) && replanContext.planNodeIds.length > 0;
  const lockedIds = Array.isArray(replanContext?.lockedNodeIds) ? replanContext.lockedNodeIds : [];
  const planSummaries = Array.isArray(replanContext?.planNodeSummaries) ? replanContext.planNodeSummaries : [];
  const planSnapshot = planSummaries.length > 0 ? JSON.stringify(planSummaries, null, 2) : '[]';

  return [
    'GENERATE WORK GRAPH',
    '',
    `Task: ${taskTitle}`,
    taskContent ? `Description: ${taskContent}` : null,
    uiUxRequired ? 'This task is UI/UX-facing: include explicit UI and UX work breakdown.' : null,
    architectureRequired ? 'This task is architecture-heavy: include backend, frontend, and data-layer change coverage.' : null,
    hasExistingPlan ? 'You are RE-SCOPING an existing graph. Update the graph from the current state; do not duplicate branches.' : null,
    hasExistingPlan ? `Locked past nodes (MUST stay unchanged): ${lockedIds.length ? lockedIds.join(', ') : '(none)'}` : null,
    hasExistingPlan ? 'Current plan snapshot (node id, type, status, deps, title):' : null,
    hasExistingPlan ? planSnapshot : null,
    '',
    'Analyze this task and create a detailed work graph as a JSON graph.',
    'The graph should break down the work into concrete steps.',
    'Scoping only: do not implement, do not run tools, do not describe file edits.',
    '',
    'Output ONLY a JSON object with this exact structure (no markdown, no explanation):',
    '{',
    '  "nodes": {',
    '    "<node-id>": {',
    '      "type": "work|spike|gate",',
    '      "title": "<short title>",',
    '      "description": "<what to do>",',
    '      "where": ["<specific subsystem/file/table/API route touched>"],',
    '      "whatChanges": ["<specific change to make in each touched area>"],',
    '      "acceptanceCriteria": ["<verifiable outcome>"],',
    '      "todos": ["<concrete implementation task>"],',
    '      "checks": ["<test/check command or assertion>"],',
    '      "estimateMinutes": <number>,',
    '      "deps": ["<dependency-node-id>"]',
    '    }',
    '  },',
    '  "edges": [',
    '    { "from": "<source-node-id>", "to": "<target-node-id>", "type": "hard" }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Node IDs should be descriptive kebab-case (e.g. "implement-auth", "add-tests")',
    '- First node(s) should have empty deps: []',
    '- Include a final "quality-gate" node with type "gate" and gateType "quality_gate"',
    '- Include a final "handoff-gate" node with type "gate" and gateType "handoff_gate" (deps on quality-gate)',
    '- Keep it practical: 3-8 work nodes for most tasks',
    '- You may use "type": "spike" for discovery/research nodes; these are treated as work nodes with workType "spike"',
    '- Each edge must match a dep relationship',
    '- Every work node MUST include non-empty where and whatChanges arrays',
    '- Every work node MUST include non-empty acceptanceCriteria, todos, and checks arrays',
    uiUxRequired
      ? '- Include dedicated UI/UX work: UI structure/components, UX states/flows, and accessibility/responsive behavior'
      : null,
    architectureRequired
      ? '- Decompose by layers/domains. Plan must identify concrete backend/API, frontend/UI, and database/schema touchpoints'
      : null,
    hasExistingPlan
      ? '- Keep locked past nodes unchanged. You may omit them from output, but if included they must be identical'
      : null,
    hasExistingPlan
      ? '- Only re-plan remaining/future work from current graph state. Avoid creating parallel duplicate tails/heads'
      : null,
    '- Do not include prose before or after the JSON object',
  ].filter(Boolean).join('\n');
}

function parsePlanOutput(rawOutput) {
  const text = String(rawOutput || '').trim();
  // Extract JSON from the output (handle markdown code blocks)
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) || [null, text];
  const jsonStr = (jsonMatch[1] || text).trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const nodes = parsed.nodes || {};
    const edges = parsed.edges || [];

    // Validate basic structure
    if (!asObject(nodes) || Object.keys(nodes).length === 0) {
      return null;
    }

    // Normalize nodes — ensure required fields
    const normalizedNodes = {};
    for (const [id, node] of Object.entries(nodes)) {
      const n = node || {};
      const rawType = String(n.type || 'work').trim().toLowerCase();
      const isGate = rawType === 'gate';
      const normalizedType = isGate ? 'gate' : 'work';
      const workType = normalizeWorkType(rawType, n.workType);
      normalizedNodes[id] = {
        type: normalizedType,
        status: 'pending',
        title: n.title || id,
        description: n.description || '',
        deps: Array.isArray(n.deps) ? n.deps : [],
        ...(normalizedType === 'work' ? {
          workType,
          attempts: 0,
          maxAttempts: n.maxAttempts || 2,
          retryPolicy: n.retryPolicy || { backoffMs: 5000, onExhaust: 'escalate' },
          estimateMinutes: n.estimateMinutes || 15,
          where: normalizeStringList(n.where),
          whatChanges: normalizeStringList(n.whatChanges),
          acceptanceCriteria: normalizeStringList(n.acceptanceCriteria),
          todos: normalizeStringList(n.todos),
          verification: normalizeStringList(Array.isArray(n.checks) ? n.checks : n.verification),
        } : {}),
        ...(normalizedType === 'gate' ? {
          gateType: n.gateType || 'progress',
          required: n.required !== false,
          verificationStrategy: n.verificationStrategy || {
            type: n.gateType === 'handoff_gate' ? 'human' : 'auto',
          },
        } : {}),
      };
    }

    // Normalize edges
    const normalizedEdges = edges
      .filter((e) => e && e.from && e.to)
      .map((e) => ({
        from: e.from,
        to: e.to,
        type: e.type || 'hard',
        condition: e.condition || 'on_success',
      }));

    return { nodes: normalizedNodes, edges: normalizedEdges };
  } catch {
    return null;
  }
}

function validateProposedPlan(proposedGraph, task, options = {}) {
  const reasons = [];
  const nodes = asObject(proposedGraph?.nodes) || {};
  const nodeEntries = Object.entries(nodes);
  const workNodes = nodeEntries.filter(([, node]) => node?.type === 'work');
  const gateNodes = nodeEntries.filter(([, node]) => node?.type === 'gate');
  const lockedNodesById = asObject(options?.lockedNodesById) || {};
  const anchorNodeId = String(options?.anchorNodeId || 'plan-approval');

  if (workNodes.length === 0) {
    reasons.push('Work graph must include at least one work node.');
  }

  for (const [nodeId, node] of workNodes) {
    const where = normalizeStringList(node?.where);
    const whatChanges = normalizeStringList(node?.whatChanges);
    const acceptanceCriteria = normalizeStringList(node?.acceptanceCriteria);
    const todos = normalizeStringList(node?.todos);
    const checks = normalizeStringList(node?.verification);
    if (where.length === 0) {
      reasons.push(`Work node "${nodeId}" is missing where (target touchpoints).`);
    }
    if (whatChanges.length === 0) {
      reasons.push(`Work node "${nodeId}" is missing whatChanges.`);
    }
    if (acceptanceCriteria.length === 0) {
      reasons.push(`Work node "${nodeId}" is missing acceptanceCriteria.`);
    }
    if (todos.length === 0) {
      reasons.push(`Work node "${nodeId}" is missing todos.`);
    }
    if (checks.length === 0) {
      reasons.push(`Work node "${nodeId}" is missing checks.`);
    }
  }

  const hasQualityGate = gateNodes.some(([, node]) => String(node?.gateType || '').toLowerCase() === 'quality_gate');
  const hasHandoffGate = gateNodes.some(([, node]) => String(node?.gateType || '').toLowerCase() === 'handoff_gate');
  if (!hasQualityGate) reasons.push('Work graph must include a quality-gate node with gateType "quality_gate".');
  if (!hasHandoffGate) reasons.push('Work graph must include a handoff-gate node with gateType "handoff_gate".');

  for (const [lockedId, lockedNode] of Object.entries(lockedNodesById)) {
    const proposedNode = nodes[lockedId];
    if (!proposedNode) continue;
    const lockedSpec = canonicalNodeSpecForCompare(lockedNode, anchorNodeId);
    const proposedSpec = canonicalNodeSpecForCompare(proposedNode, anchorNodeId);
    if (stableStringify(lockedSpec) !== stableStringify(proposedSpec)) {
      reasons.push(`Locked past node "${lockedId}" must remain unchanged.`);
    }
  }

  if (isUiUxTask(task)) {
    const searchable = workNodes
      .map(([, node]) => {
        const title = String(node?.title || '');
        const description = String(node?.description || '');
        const where = normalizeStringList(node?.where).join(' ');
        const whatChanges = normalizeStringList(node?.whatChanges).join(' ');
        const acceptanceCriteria = normalizeStringList(node?.acceptanceCriteria).join(' ');
        const todos = normalizeStringList(node?.todos).join(' ');
        return `${title} ${description} ${where} ${whatChanges} ${acceptanceCriteria} ${todos}`.toLowerCase();
      })
      .join('\n');
    const hasUiCoverage = /(ui|interface|component|layout|view)/.test(searchable);
    const hasUxCoverage = /(ux|flow|state|loading|empty|error|accessibility|responsive|keyboard)/.test(searchable);
    if (!hasUiCoverage) reasons.push('UI/UX task requires at least one node with explicit UI/component scope.');
    if (!hasUxCoverage) reasons.push('UI/UX task requires UX states/flows (loading, empty, error, accessibility, responsive, etc.).');
  }

  if (isArchitectureHeavyTask(task)) {
    if (workNodes.length < 5) {
      reasons.push('Architecture-heavy task should decompose into at least 5 work nodes.');
    }
    const searchable = workNodes
      .map(([, node]) => {
        const title = String(node?.title || '');
        const description = String(node?.description || '');
        const where = normalizeStringList(node?.where).join(' ');
        const whatChanges = normalizeStringList(node?.whatChanges).join(' ');
        return `${title} ${description} ${where} ${whatChanges}`.toLowerCase();
      })
      .join('\n');
    const hasBackendCoverage = /(backend|fastapi|api|route|service|repository|worker|celery|job)/.test(searchable);
    const hasFrontendCoverage = /(frontend|react|ui|page|component|modal|dashboard)/.test(searchable);
    const hasDataCoverage = /(database|postgres|schema|table|migration|model|query)/.test(searchable);
    if (!hasBackendCoverage) reasons.push('Architecture-heavy task requires explicit backend/API touchpoints.');
    if (!hasFrontendCoverage) reasons.push('Architecture-heavy task requires explicit frontend/UI touchpoints.');
    if (!hasDataCoverage) reasons.push('Architecture-heavy task requires explicit data/schema touchpoints.');
  }

  return { ok: reasons.length === 0, reasons };
}

function normalizeDraftNodeType(type) {
  if (type === 'spike') return 'work';
  if (type === 'work' || type === 'gate' || type === 'fork' || type === 'join' || type === 'conditional') {
    return type;
  }
  return 'work';
}

function sanitizeNodeId(raw, fallback = 'draft-node') {
  const trimmed = String(raw || '').trim();
  const normalized = trimmed
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
}

function edgeFingerprint(edge) {
  const from = String(edge?.from || '');
  const to = String(edge?.to || '');
  const type = String(edge?.type || 'hard');
  const condition = String(edge?.condition || 'on_success');
  return `${from}|${to}|${type}|${condition}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalNodeSpecForCompare(node, anchorNodeId) {
  const type = normalizeDraftNodeType(node?.type);
  const spec = {
    type,
    workType: type === 'work' ? normalizeWorkType(node?.type, node?.workType) : undefined,
    title: String(node?.title || '').trim(),
    description: String(node?.description || '').trim(),
    where: normalizeStringList(node?.where),
    whatChanges: normalizeStringList(node?.whatChanges),
    acceptanceCriteria: normalizeStringList(node?.acceptanceCriteria),
    todos: normalizeStringList(node?.todos),
    verification: normalizeStringList(node?.verification),
    gateType: type === 'gate' ? String(node?.gateType || 'progress') : undefined,
    required: type === 'gate' ? node?.required !== false : undefined,
    verificationStrategy: type === 'gate' ? (asObject(node?.verificationStrategy) || {}) : undefined,
    estimateMinutes: type === 'work' ? (Number.isFinite(node?.estimateMinutes) ? Number(node.estimateMinutes) : 15) : undefined,
    maxAttempts: type === 'work' ? (Number.isInteger(node?.maxAttempts) ? Number(node.maxAttempts) : 2) : undefined,
    retryPolicy: type === 'work' ? (asObject(node?.retryPolicy) || { backoffMs: 5000, onExhaust: 'escalate' }) : undefined,
  };
  const deps = Array.isArray(node?.deps) ? node.deps : [];
  spec.deps = Array.from(new Set(
    deps
      .map((dep) => String(dep || '').trim())
      .filter(Boolean)
      .filter((dep) => dep !== anchorNodeId)
  )).sort();
  return spec;
}

function mergeProposedDraftGraph({ graph, proposedGraph, anchorNodeId = 'plan-approval', sourcePlanNodeId = 'plan' }) {
  const draftNodes = asObject(proposedGraph?.nodes) || {};
  const draftEdges = Array.isArray(proposedGraph?.edges) ? proposedGraph.edges : [];
  const sourceIds = Object.keys(draftNodes);
  if (sourceIds.length === 0) {
    return { graph, draftNodeIds: [], sinkNodeIds: [] };
  }

  const mergedGraph = graph;
  if (!asObject(mergedGraph.nodes)) mergedGraph.nodes = {};
  if (!Array.isArray(mergedGraph.edges)) mergedGraph.edges = [];
  if (!asObject(mergedGraph.doneCriteria)) mergedGraph.doneCriteria = {};

  const usedIds = new Set(Object.keys(mergedGraph.nodes));
  const idMap = {};

  for (const sourceId of sourceIds) {
    const base = sanitizeNodeId(sourceId);
    let candidate = base;
    if (usedIds.has(candidate)) {
      candidate = `draft-${base}`;
    }
    let suffix = 2;
    while (usedIds.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    idMap[sourceId] = candidate;
    usedIds.add(candidate);
  }

  const mappedNodeIds = Object.values(idMap);
  const mappedNodeSet = new Set(mappedNodeIds);

  for (const sourceId of sourceIds) {
    const mappedId = idMap[sourceId];
    const raw = asObject(draftNodes[sourceId]) || {};
    const type = normalizeDraftNodeType(raw.type);
    const depsRaw = Array.isArray(raw.deps) ? raw.deps : [];
    const deps = Array.from(new Set(
      depsRaw
        .map((dep) => String(dep || '').trim())
        .filter(Boolean)
        .map((dep) => idMap[dep] || dep)
        .filter((dep) => dep !== mappedId)
    ));

    const nextNode = {
      ...raw,
      type,
      status: 'pending',
      deps,
      generatedByPlanNodeId: sourcePlanNodeId,
      planNodeKey: sourceId,
    };

    if (type === 'work') {
      nextNode.title = String(raw.title || mappedId).trim() || mappedId;
      nextNode.workType = normalizeWorkType(raw.type, raw.workType);
      nextNode.attempts = Number.isInteger(raw.attempts) ? raw.attempts : 0;
      nextNode.maxAttempts = Number.isInteger(raw.maxAttempts) ? raw.maxAttempts : 2;
      nextNode.retryPolicy = asObject(raw.retryPolicy) || { backoffMs: 5000, onExhaust: 'escalate' };
      nextNode.estimateMinutes = Number.isFinite(raw.estimateMinutes) ? raw.estimateMinutes : 15;
    } else if (type === 'gate') {
      nextNode.gateType = String(raw.gateType || 'progress');
      nextNode.required = raw.required !== false;
      nextNode.verificationStrategy = asObject(raw.verificationStrategy) || {
        type: nextNode.gateType === 'handoff_gate' ? 'human' : 'auto',
      };
    } else if (type === 'join') {
      nextNode.joinStrategy = raw.joinStrategy || 'all';
    } else if (type === 'conditional') {
      nextNode.condition = asObject(raw.condition) || { expression: 'true', inputFrom: deps[0] || mappedId };
      nextNode.thenBranch = Array.isArray(raw.thenBranch) ? raw.thenBranch.map((id) => idMap[id] || id) : [];
      nextNode.elseBranch = Array.isArray(raw.elseBranch) ? raw.elseBranch.map((id) => idMap[id] || id) : [];
    }

    nextNode.deps = Array.from(new Set(
      (Array.isArray(nextNode.deps) ? nextNode.deps : [])
        .map((dep) => String(dep || '').trim())
        .filter(Boolean)
    ));

    mergedGraph.nodes[mappedId] = nextNode;
  }

  const edgeSet = new Set(mergedGraph.edges.map((edge) => edgeFingerprint(edge)));
  const addEdge = (edge) => {
    if (!edge || !edge.from || !edge.to) return;
    if (!mergedGraph.nodes[edge.from] || !mergedGraph.nodes[edge.to]) return;
    const normalized = {
      from: String(edge.from),
      to: String(edge.to),
      type: edge.type === 'soft' ? 'soft' : 'hard',
      condition: edge.condition || 'on_success',
    };
    const key = edgeFingerprint(normalized);
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    mergedGraph.edges.push(normalized);
  };

  for (const rawEdge of draftEdges) {
    const from = idMap[String(rawEdge?.from || '').trim()] || String(rawEdge?.from || '').trim();
    const to = idMap[String(rawEdge?.to || '').trim()] || String(rawEdge?.to || '').trim();
    addEdge({
      from,
      to,
      type: rawEdge?.type || 'hard',
      condition: rawEdge?.condition || 'on_success',
    });
  }

  const anchorExists = Boolean(mergedGraph.nodes[anchorNodeId]);
  if (anchorExists) {
    for (const nodeId of mappedNodeIds) {
      const node = mergedGraph.nodes[nodeId];
      if (!node) continue;
      const deps = Array.isArray(node.deps) ? node.deps : [];
      const filteredDeps = Array.from(new Set(
        deps.filter((dep) => dep && dep !== nodeId && mergedGraph.nodes[dep])
      ));
      if (!filteredDeps.includes(anchorNodeId)) {
        filteredDeps.push(anchorNodeId);
      }
      addEdge({
        from: anchorNodeId,
        to: nodeId,
        type: 'hard',
        condition: 'on_success',
      });
      node.deps = filteredDeps;
    }
  }

  const draftInternalEdges = mergedGraph.edges.filter(
    (edge) => mappedNodeSet.has(edge.from) && mappedNodeSet.has(edge.to)
  );
  const sinkNodeIds = mappedNodeIds.filter(
    (nodeId) => !draftInternalEdges.some((edge) => edge.from === nodeId)
  );

  if (sinkNodeIds.length > 0) {
    const existingSinks = Array.isArray(mergedGraph.doneCriteria.completionSinkNodeIds)
      ? mergedGraph.doneCriteria.completionSinkNodeIds
      : [];
    mergedGraph.doneCriteria.completionSinkNodeIds = Array.from(new Set([
      ...existingSinks.filter((id) => id !== anchorNodeId),
      ...sinkNodeIds,
    ]));
  }

  return { graph: mergedGraph, draftNodeIds: mappedNodeIds, sinkNodeIds };
}

function stripLockedNodesFromProposedGraph(proposedGraph, lockedNodeIds) {
  const lockedIdSet = new Set(
    (Array.isArray(lockedNodeIds) ? lockedNodeIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );
  const srcNodes = asObject(proposedGraph?.nodes) || {};
  const srcEdges = Array.isArray(proposedGraph?.edges) ? proposedGraph.edges : [];
  const nextNodes = {};
  for (const [id, node] of Object.entries(srcNodes)) {
    if (lockedIdSet.has(id)) continue;
    nextNodes[id] = node;
  }
  const nextEdges = srcEdges.filter((edge) => {
    const from = String(edge?.from || '').trim();
    const to = String(edge?.to || '').trim();
    if (!from || !to) return false;
    return !(lockedIdSet.has(from) && lockedIdSet.has(to));
  });
  return { nodes: nextNodes, edges: nextEdges };
}

function replacePlanGraph({
  graph,
  planNodeId,
  proposedGraph,
  anchorNodeId = 'plan-approval',
  previousDraftNodeIds = [],
  lockedNodeIds = [],
}) {
  const mergedGraph = graph;
  if (!asObject(mergedGraph.nodes)) mergedGraph.nodes = {};
  if (!Array.isArray(mergedGraph.edges)) mergedGraph.edges = [];
  if (!asObject(mergedGraph.doneCriteria)) mergedGraph.doneCriteria = {};

  const explicitPlanNodeIds = collectPlanNodeIds(mergedGraph, planNodeId, previousDraftNodeIds);
  const topoPlanNodeIds = collectDescendantNodeIds(mergedGraph, anchorNodeId)
    .filter((nodeId) => nodeId !== planNodeId && nodeId !== anchorNodeId);
  const previousPlanNodeIds = Array.from(new Set([...explicitPlanNodeIds, ...topoPlanNodeIds]));
  const previousPlanNodeSet = new Set(previousPlanNodeIds);
  const lockedNodeSet = new Set(
    (Array.isArray(lockedNodeIds) ? lockedNodeIds : [])
      .map((id) => String(id || '').trim())
      .filter((id) => previousPlanNodeSet.has(id) && mergedGraph.nodes[id])
  );

  const removableNodeIds = previousPlanNodeIds.filter((id) => !lockedNodeSet.has(id));
  const removableNodeSet = new Set(removableNodeIds);
  for (const nodeId of removableNodeIds) {
    delete mergedGraph.nodes[nodeId];
  }
  mergedGraph.edges = mergedGraph.edges.filter((edge) => !removableNodeSet.has(edge?.from) && !removableNodeSet.has(edge?.to));
  for (const node of Object.values(mergedGraph.nodes)) {
    if (!node || !Array.isArray(node.deps)) continue;
    node.deps = node.deps.filter((dep) => !removableNodeSet.has(dep));
  }

  const sanitizedProposedGraph = stripLockedNodesFromProposedGraph(proposedGraph, Array.from(lockedNodeSet));
  const { graph: replacedGraph, draftNodeIds: newDraftNodeIds } = mergeProposedDraftGraph({
    graph: mergedGraph,
    proposedGraph: sanitizedProposedGraph,
    anchorNodeId,
    sourcePlanNodeId: planNodeId,
  });

  const currentPlanNodeIds = Object.entries(replacedGraph.nodes)
    .filter(([, node]) => node && node.generatedByPlanNodeId === planNodeId)
    .map(([nodeId]) => nodeId);
  const currentPlanNodeSet = new Set(currentPlanNodeIds);
  const planInternalEdges = replacedGraph.edges.filter(
    (edge) => currentPlanNodeSet.has(edge.from) && currentPlanNodeSet.has(edge.to)
  );
  const sinkNodeIds = currentPlanNodeIds.filter(
    (nodeId) => !planInternalEdges.some((edge) => edge.from === nodeId)
  );
  const nonPlanSinks = (Array.isArray(replacedGraph.doneCriteria.completionSinkNodeIds)
    ? replacedGraph.doneCriteria.completionSinkNodeIds
    : []).filter((id) => !previousPlanNodeSet.has(id) && !currentPlanNodeSet.has(id));
  replacedGraph.doneCriteria.completionSinkNodeIds = Array.from(new Set([
    ...nonPlanSinks,
    ...sinkNodeIds,
  ]));

  return {
    graph: replacedGraph,
    draftNodeIds: Array.from(new Set([...currentPlanNodeIds, ...newDraftNodeIds])),
    sinkNodeIds,
  };
}

function formatPromptList(label, items) {
  const values = normalizeStringList(items);
  if (values.length === 0) return null;
  return [
    `${label}:`,
    ...values.map((item) => `- ${item}`),
  ].join('\n');
}

function buildWorkNodePrompt({ task, nodeId, node }) {
  const taskTitle = String(task?.title || task?.goal || task?.user_request || '').trim() || 'Untitled task';
  const taskContent = resolveTaskPromptBody(task);
  const nodeTitle = String(node?.title || '').trim() || nodeId;
  const nodeDescription = String(node?.description || '').trim();
  const workType = String(node?.workType || '').trim();
  const where = formatPromptList('Where (targets)', node?.where);
  const whatChanges = formatPromptList('Planned Changes', node?.whatChanges);
  const acceptanceCriteria = formatPromptList('Acceptance Criteria', node?.acceptanceCriteria);
  const todos = formatPromptList('To Dos', node?.todos);
  const verification = formatPromptList('Validation Expectations', node?.verification);

  return [
    'WORK NODE',
    '',
    `Task: ${taskTitle}`,
    taskContent ? `Task Objective: ${taskContent}` : null,
    `Node ID: ${nodeId}`,
    `Node Title: ${nodeTitle}`,
    workType ? `Work Type: ${workType}` : null,
    nodeDescription ? `Node Description: ${nodeDescription}` : null,
    where,
    whatChanges,
    acceptanceCriteria,
    todos,
    verification,
    '',
    'Do the work required for this node. Apply changes directly to the repository.',
    'Use the plan details above as requirements for implementation.',
    'Keep output concise and include a short implementation summary and validation notes.',
  ].filter(Boolean).join('\n');
}

function buildVerificationChecks(node) {
  const checks = node?.verificationStrategy?.checks;
  if (!Array.isArray(checks)) return [];
  return checks
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

async function loadGraphForTask({ taskId, task, cloudRequest }) {
  const embedded = readEmbeddedGraph(task);
  if (embedded) return normalizeGraph(embedded, taskId);

  if (typeof cloudRequest !== 'function') {
    throw new Error(`[v2-required] Task ${taskId} missing embedded graph and no cloud graph loader is available.`);
  }

  const attemptsRaw = Number(process.env.AGX_V2_GRAPH_LOAD_RETRIES || 3);
  const maxAttempts = Number.isFinite(attemptsRaw) && attemptsRaw > 0 ? Math.floor(attemptsRaw) : 3;
  let response;
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await cloudRequest('GET', `/api/tasks/${taskId}/graph`);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const backoffMs = Math.min(2000, 250 * (2 ** (attempt - 1)));
        await sleep(backoffMs);
      }
    }
  }

  if (lastErr) {
    throw new Error(`[v2-required] Failed to load graph for task ${taskId} via GET /api/tasks/${taskId}/graph after ${maxAttempts} attempt(s): ${lastErr?.message || lastErr}`);
  }

  const parsed = normalizeGraph(readGraphFromResponse(response), taskId);
  if (!parsed) {
    throw new Error(`[v2-required] Graph endpoint returned invalid payload for task ${taskId}.`);
  }
  return parsed;
}

async function persistGraphToCloud({ cloudRequest, taskId, graph }) {
  if (typeof cloudRequest !== 'function') return graph;

  const basePatch = {
    graphId: graph.id,
    mode: graph.mode,
    nodes: graph.nodes,
    edges: graph.edges,
    policy: graph.policy,
    doneCriteria: graph.doneCriteria,
    ifMatchGraphVersion: graph.graphVersion,
  };

  const payloads = [
    // Prefer minimal top-level patch shape accepted by /api/tasks/:id/graph.
    basePatch,
    // Fallback: wrapped graph shape for backward-compatible board runtimes.
    { graph: basePatch, ifMatchGraphVersion: graph.graphVersion },
  ];

  let lastErr = null;
  for (const payload of payloads) {
    try {
      const response = await cloudRequest('PATCH', `/api/tasks/${taskId}/graph`, payload);
      const responseGraph = normalizeGraph(readGraphFromResponse(response), taskId);
      if (!responseGraph) return graph;
      // Some cloud runtimes only echo structural graph fields. Preserve local
      // execution-state fields so terminal decisions remain accurate.
      responseGraph.status = responseGraph.status || graph.status;
      responseGraph.startedAt = responseGraph.startedAt || graph.startedAt;
      responseGraph.completedAt = responseGraph.completedAt || graph.completedAt;
      responseGraph.timedOutAt = responseGraph.timedOutAt || graph.timedOutAt;
      if (!Array.isArray(responseGraph.runtimeEvents) || responseGraph.runtimeEvents.length === 0) {
        responseGraph.runtimeEvents = Array.isArray(graph.runtimeEvents) ? graph.runtimeEvents : [];
      }
      return responseGraph;
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(`[v2-required] Failed to persist graph for task ${taskId} via PATCH /api/tasks/${taskId}/graph: ${lastErr?.message || lastErr}`);
}

function makeDecision({ outcome, message, nextPrompt = '', graph, extra = {} }) {
  return {
    done: outcome === 'done',
    decision: outcome,
    explanation: message,
    final_result: message,
    next_prompt: nextPrompt,
    summary: message,
    graph_id: graph?.id || null,
    graph_version: graph?.graphVersion || null,
    ...extra,
  };
}

function createNodeScopedLogger(logger, nodeId) {
  const normalizedNodeId = typeof nodeId === 'string' && nodeId.trim() ? nodeId.trim() : null;
  if (!logger || typeof logger.log !== 'function' || !normalizedNodeId) {
    return logger;
  }
  return {
    log(type, data) {
      logger.log(type, data, normalizedNodeId);
    },
    flushAll: typeof logger.flushAll === 'function'
      ? () => logger.flushAll()
      : undefined,
  };
}

function createCloudExecuteGraphV2(env) {
  const {
    logExecutionFlow,
    abortIfCancelled,
    createDaemonArtifactsRecorder,
    runSingleAgentIteration,
    runSingleAgentPlanIteration,
    buildLocalRunIndexEntry,
    finalizeRunSafe,
  } = env || {};

  const baseProcEnv = typeof process !== 'undefined' && process.env ? process.env : {};

  async function executeWorkNode({
    taskId,
    task,
    provider,
    model,
    nodeId,
    node,
    graphRun,
    artifacts,
    logger,
    cancellationWatcher,
  }) {
    const prompt = buildWorkNodePrompt({ task, nodeId, node });
    artifacts.recordPrompt(`Node Prompt (${nodeId})`, prompt);
    const nodeLogger = createNodeScopedLogger(logger, nodeId);

    const output = await runSingleAgentIteration({
      taskId,
      task,
      provider,
      model,
      prompt,
      env: {
        ...baseProcEnv,
        AGX_RUN_ROOT: graphRun?.paths?.root || '',
        AGX_RUN_PLAN_DIR: graphRun?.paths?.plan || '',
        AGX_RUN_ARTIFACTS_DIR: graphRun?.paths?.artifacts || '',
      },
      logger: nodeLogger,
      artifacts,
      cancellationWatcher,
      cwd: process.cwd(),
    });

    artifacts.recordOutput(`Node Output (${nodeId})`, output || '');
    return output;
  }

  async function executePlanNode({
    taskId,
    task,
    provider,
    model,
    nodeId,
    node,
    graphRun,
    artifacts,
    logger,
    cancellationWatcher,
    replanContext = null,
  }) {
    const prompt = buildPlanNodePrompt({ task, replanContext });
    artifacts.recordPrompt(`Plan Prompt (${nodeId})`, prompt);
    const nodeLogger = createNodeScopedLogger(logger, nodeId);

    const planIterationRunner = typeof runSingleAgentPlanIteration === 'function'
      ? runSingleAgentPlanIteration
      : runSingleAgentIteration;

    const runPlanner = async (planPrompt) => planIterationRunner({
      taskId,
      task,
      provider,
      model,
      prompt: planPrompt,
      env: {
        ...baseProcEnv,
        AGX_RUN_ROOT: graphRun?.paths?.root || '',
        AGX_RUN_PLAN_DIR: graphRun?.paths?.plan || '',
        AGX_RUN_ARTIFACTS_DIR: graphRun?.paths?.artifacts || '',
      },
      logger: nodeLogger,
      artifacts,
      cancellationWatcher,
      cwd: process.cwd(),
    });

    let rawOutput = await runPlanner(prompt);
    artifacts.recordOutput(`Plan Output (${nodeId})`, rawOutput || '');

    let proposedGraph = parsePlanOutput(rawOutput);
    let planValidation = validateProposedPlan(proposedGraph, task, {
      lockedNodesById: replanContext?.lockedNodesById,
      anchorNodeId: 'plan-approval',
    });
    if (!proposedGraph || !planValidation.ok) {
      const reasons = !proposedGraph
        ? ['First planner response was not valid graph JSON.']
        : planValidation.reasons;
      artifacts.recordOutput(`Plan Validation Error (${nodeId})`, reasons.join('\n'));
      const retryPrompt = [
        prompt,
        '',
        'Your previous response did not pass plan validation.',
        'Fix all issues below and return only valid JSON:',
        ...reasons.slice(0, 12).map((reason) => `- ${reason}`),
        '',
        'No markdown, no explanations, no implementation steps.',
      ].join('\n');
      rawOutput = await runPlanner(retryPrompt);
      artifacts.recordOutput(`Plan Output Retry (${nodeId})`, rawOutput || '');
      proposedGraph = parsePlanOutput(rawOutput);
      planValidation = validateProposedPlan(proposedGraph, task, {
        lockedNodesById: replanContext?.lockedNodesById,
        anchorNodeId: 'plan-approval',
      });
    }
    if (!proposedGraph) {
      throw new Error('LLM plan output could not be parsed into a valid graph structure');
    }
    if (!planValidation.ok) {
      throw new Error(`LLM plan output missing required plan details: ${planValidation.reasons.join(' | ')}`);
    }

    artifacts.recordOutput(`Proposed Graph (${nodeId})`, JSON.stringify(proposedGraph, null, 2));
    return proposedGraph;
  }

  async function executeGateNode({ node, cwd, onLog, approvalMode }) {
    const gateType = String(node?.gateType || 'progress').toLowerCase();
    if (approvalMode === 'auto' && gateType === 'approval_gate') {
      return {
        status: 'passed',
        verificationResult: {
          passed: true,
          checks: [],
          verifiedAt: nowIso(),
          verifiedBy: 'auto_approval',
        },
        reason: 'Task approval mode is auto; approval gate auto-approved.',
      };
    }

    const strategy = String(node?.verificationStrategy?.type || 'auto').toLowerCase();
    if (strategy === 'human') {
      return {
        status: 'awaiting_human',
        verificationResult: {
          passed: false,
          checks: [],
          verifiedAt: nowIso(),
          verifiedBy: 'human',
        },
        reason: 'Gate requires human verification.',
      };
    }

    const checks = buildVerificationChecks(node);
    const gateResult = await runVerifyGate({
      criteria: checks,
      cwd,
      verifyFailures: Number(node?.verifyFailures || 0),
      onLog: (line) => onLog?.(line),
    });

    if (gateResult.forceAction) {
      return {
        status: 'failed',
        verificationResult: {
          passed: false,
          checks: gateResult.results || [],
          verifiedAt: nowIso(),
          verifiedBy: 'agent',
        },
        reason: gateResult.reason || 'Verification gate exhausted retries.',
        verifyFailures: gateResult.verifyFailures,
      };
    }

    if (gateResult.needsLlm) {
      return {
        status: 'awaiting_human',
        verificationResult: {
          passed: false,
          checks: gateResult.results || [],
          verifiedAt: nowIso(),
          verifiedBy: 'agent',
        },
        reason: 'Gate includes semantic checks and requires human verification.',
        verifyFailures: gateResult.verifyFailures,
      };
    }

    return {
      status: gateResult.passed ? 'passed' : 'failed',
      verificationResult: {
        passed: Boolean(gateResult.passed),
        checks: gateResult.results || [],
        verifiedAt: nowIso(),
        verifiedBy: 'agent',
      },
      reason: gateResult.passed ? 'Gate checks passed.' : 'Gate checks failed.',
      verifyFailures: gateResult.verifyFailures,
    };
  }

  async function runV2GraphExecutionLoop({
    taskId,
    task,
    provider,
    model,
    logger,
    storage,
    projectSlug,
    taskSlug,
    stageLocal,
    initialPromptContext,
    cancellationWatcher,
    cloudRequest,
  }) {
    logExecutionFlow('runV2GraphExecutionLoop', 'input', `taskId=${taskId}, provider=${provider}, model=${model}, stage=${stageLocal}`);

    const maxTicksRaw = Number(process.env.AGX_V2_MAX_TICKS || 200);
    const maxTicks = Number.isFinite(maxTicksRaw) && maxTicksRaw > 0 ? Math.floor(maxTicksRaw) : 200;

    const graphRun = await storage.createRun({
      projectSlug,
      taskSlug,
      stage: stageLocal || 'execute',
      engine: provider,
      model: model || undefined,
    });
    const artifacts = createDaemonArtifactsRecorder({ storage, run: graphRun, taskId });
    if (initialPromptContext) {
      artifacts.recordPrompt('Initial Task Context', initialPromptContext);
    }
    try {
      let graph = await loadGraphForTask({ taskId, task, cloudRequest });
      assertGraphShape(graph, taskId);
      const taskApprovalMode = resolveTaskApprovalMode(task);
      const startNodeSelection = applyStartNodeSelection(graph, task);
      const activeStartNodeId = startNodeSelection.activeStartNodeId;

      graph.startedAt = graph.startedAt || nowIso();
      artifacts.recordOutput('Graph Loaded', JSON.stringify({
        graphId: graph.id,
        graphVersion: graph.graphVersion,
        mode: graph.mode,
        approvalMode: taskApprovalMode,
        startNodeId: activeStartNodeId || undefined,
        startNodeRerun: startNodeSelection.wasWorkNodeRerun,
        resetApprovalGateIds: startNodeSelection.resetApprovalGateIds,
        nodeCount: Object.keys(graph.nodes || {}).length,
        edgeCount: Array.isArray(graph.edges) ? graph.edges.length : 0,
      }, null, 2));

      await storage.writeTaskGraph(projectSlug, taskSlug, graph);
      graph = await persistGraphToCloud({ cloudRequest, taskId, graph });
      assertGraphShape(graph, taskId);

      let tickCount = 0;
      let stalledTicks = 0;
      let previousFingerprint = nodeStatusFingerprint(graph);

      while (tickCount < maxTicks) {
        tickCount += 1;
        await abortIfCancelled(cancellationWatcher);
        logExecutionFlow('runV2GraphExecutionLoop', 'processing', `taskId=${taskId}, tick=${tickCount}`);

        const tickNow = nowIso();
        const tickResult = schedulerTick(graph, {
          now: tickNow,
          allowedNodeIds: activeStartNodeId ? [activeStartNodeId] : undefined,
        });
        graph = tickResult?.graph ? tickResult.graph : graph;
        if (!Array.isArray(graph.runtimeEvents)) graph.runtimeEvents = [];
        for (const event of (tickResult?.events || [])) {
          graph.runtimeEvents.push({
            ...event,
            graphId: graph.id,
            timestamp: event?.timestamp || tickNow,
          });
        }

        // Persist scheduler transitions (e.g. pending -> running) immediately so
        // UI reflects in-flight execution before potentially long node work begins.
        if ((tickResult?.events || []).length > 0) {
          graph.updatedAt = nowIso();
          await storage.writeTaskGraph(projectSlug, taskSlug, graph);
          graph = await persistGraphToCloud({ cloudRequest, taskId, graph });
          assertGraphShape(graph, taskId);
        }

        const runnableNodeIds = collectNodeIdsByStatus(graph, ['running']);
        let progressedThisTick = false;

        for (const nodeId of runnableNodeIds) {
          const node = graph.nodes[nodeId];
          if (!node || node.status !== 'running') continue;

          const startedAt = node.startedAt || tickNow;
          const startedMs = Date.parse(startedAt);
          node.startedAt = startedAt;

          if (node.type === 'work' && isPlanNode(nodeId, node)) {
            // Special handling: plan node generates a draft execution graph
            try {
              const previousDraftNodeIds = Array.isArray(node?.output?.draftNodeIds) ? node.output.draftNodeIds : [];
              const isPlanRerun = Boolean(node?.completedAt) || Boolean(asObject(node?.output)?.proposedGraph);
              const replanContext = isPlanRerun
                ? null
                : buildPlanReplanContext({
                  graph,
                  planNodeId: nodeId,
                  previousDraftNodeIds,
                  anchorNodeId: 'plan-approval',
                  preserveLockedPastNodes: true,
                });
              const proposedGraph = await executePlanNode({
                taskId,
                task,
                provider,
                model,
                nodeId,
                node,
                graphRun,
                artifacts,
                logger,
                cancellationWatcher,
                replanContext,
              });
              const { draftNodeIds, sinkNodeIds } = replacePlanGraph({
                graph,
                planNodeId: nodeId,
                proposedGraph,
                anchorNodeId: 'plan-approval',
                previousDraftNodeIds,
                lockedNodeIds: replanContext?.lockedNodeIds || [],
              });
              node.status = 'done';
              node.error = undefined;
              node.output = {
                ...(asObject(node.output) || {}),
                proposedGraph,
                draftNodeIds,
                draftSinkNodeIds: sinkNodeIds,
                summary: `Generated execution plan with ${draftNodeIds.length} draft nodes`,
                completedAt: nowIso(),
              };
              // Mark root as graphCreated
              const rootNode = graph.nodes.root || graph.nodes.ROOT;
              if (rootNode && rootNode.graphCreated === false) {
                rootNode.graphCreated = true;
              }
              progressedThisTick = true;
            } catch (err) {
              const attempts = Number(node.attempts || 0) + 1;
              node.attempts = attempts;
              node.error = String(err?.message || err || 'plan generation failed');
              const maxAttempts = Number.isInteger(node.maxAttempts) ? node.maxAttempts : 1;
              if (attempts < maxAttempts) {
                node.status = 'pending';
              } else {
                node.status = 'failed';
                node.completedAt = nowIso();
              }
              progressedThisTick = true;
            }
          } else if (node.type === 'work') {
            try {
              const output = await executeWorkNode({
                taskId,
                task,
                provider,
                model,
                nodeId,
                node,
                graphRun,
                artifacts,
                logger,
                cancellationWatcher,
              });
              node.status = 'done';
              node.error = undefined;
              node.output = {
                ...(asObject(node.output) || {}),
                summary: String(output || '').slice(0, 8000),
                completedAt: nowIso(),
              };
              progressedThisTick = true;
            } catch (err) {
              const attempts = Number(node.attempts || 0) + 1;
              node.attempts = attempts;
              node.error = String(err?.message || err || 'work node failed');
              const maxAttempts = Number.isInteger(node.maxAttempts) ? node.maxAttempts : 1;
              if (attempts < maxAttempts) {
                node.status = 'pending';
              } else {
                node.status = 'failed';
                node.completedAt = nowIso();
              }
              progressedThisTick = true;
            }
          } else if (node.type === 'gate') {
            const nodeLogger = createNodeScopedLogger(logger, nodeId);
            const gateResult = await executeGateNode({
              node,
              cwd: os.homedir(),
              onLog: (line) => nodeLogger?.log?.('system', `[v2-gate][${nodeId}] ${line}\n`),
              approvalMode: taskApprovalMode,
            });
            node.status = gateResult.status;
            node.verificationResult = gateResult.verificationResult;
            node.verifyFailures = gateResult.verifyFailures;
            node.error = gateResult.status === 'failed' ? gateResult.reason : undefined;
            progressedThisTick = true;
          } else {
            node.status = 'done';
            progressedThisTick = true;
          }

          if (node.status === 'done' || node.status === 'passed' || node.status === 'failed' || node.status === 'skipped') {
            node.completedAt = node.completedAt || nowIso();
            if (Number.isFinite(startedMs)) {
              const elapsedMs = Math.max(0, Date.now() - startedMs);
              node.actualMinutes = Math.max(1, Math.round(elapsedMs / 60000));
            }
          }
        }

        graph.updatedAt = nowIso();
        await storage.writeTaskGraph(projectSlug, taskSlug, graph);
        graph = await persistGraphToCloud({ cloudRequest, taskId, graph });
        assertGraphShape(graph, taskId);

        if (activeStartNodeId) {
          const selectedNode = graph.nodes?.[activeStartNodeId];
          const selectedStatus = normalizeNodeStatus(selectedNode?.status);
          if (selectedNode && isTerminalStatus(selectedStatus)) {
            const singleNodeSucceeded = selectedStatus === 'done' || selectedStatus === 'passed' || selectedStatus === 'skipped';
            const summary = singleNodeSucceeded
              ? `v2 graph start node "${activeStartNodeId}" completed with status ${selectedStatus}.`
              : `v2 graph start node "${activeStartNodeId}" failed with status ${selectedStatus}.`;
            await artifacts.flush();
            await finalizeRunSafe(storage, graphRun, {
              status: singleNodeSucceeded ? 'done' : 'failed',
              reason: singleNodeSucceeded
                ? `v2 start node completed (${activeStartNodeId})`
                : `v2 start node failed (${activeStartNodeId})`,
            });
            const runIndexEntry = await buildLocalRunIndexEntry(storage, graphRun, singleNodeSucceeded ? 'done' : 'failed');
            return {
              code: singleNodeSucceeded ? 0 : 1,
              decision: makeDecision({
                outcome: singleNodeSucceeded ? 'done' : 'failed',
                message: summary,
                graph,
                extra: {
                  start_node_id: activeStartNodeId,
                  start_node_status: selectedStatus,
                },
              }),
              lastRun: graphRun,
              runIndexEntry,
            };
          }
        }

        const fingerprint = nodeStatusFingerprint(graph);
        if (progressedThisTick || fingerprint !== previousFingerprint) {
          stalledTicks = 0;
        } else {
          stalledTicks += 1;
        }
        previousFingerprint = fingerprint;

        if (!hasIncompleteNodes(graph)) {
          graph.completedAt = graph.completedAt || nowIso();
          graph.status = allCompletionSinksPassed(graph) ? 'done' : 'failed';
          await storage.writeTaskGraph(projectSlug, taskSlug, graph);
          graph = await persistGraphToCloud({ cloudRequest, taskId, graph });

          const summary = graph.status === 'done'
            ? `v2 graph ${graph.id} completed successfully (version ${graph.graphVersion}).`
            : `v2 graph ${graph.id} finished with failures (version ${graph.graphVersion}).`;

          artifacts.recordOutput('Graph Final State', JSON.stringify({
            graphId: graph.id,
            graphVersion: graph.graphVersion,
            status: graph.status,
            completedAt: graph.completedAt,
          }, null, 2));
          await artifacts.flush();
          await finalizeRunSafe(storage, graphRun, {
            status: graph.status === 'done' ? 'done' : 'failed',
            reason: graph.status === 'done'
              ? `v2 graph completed (${graph.id})`
              : `v2 graph finished with failed nodes (${graph.id})`,
          });

          const runIndexEntry = await buildLocalRunIndexEntry(storage, graphRun, graph.status);
          return {
            code: graph.status === 'done' ? 0 : 1,
            decision: makeDecision({
              outcome: graph.status === 'done' ? 'done' : 'failed',
              message: summary,
              graph,
            }),
            lastRun: graphRun,
            runIndexEntry,
          };
        }

        const awaitingHuman = collectNodeIdsByStatus(graph, ['awaiting_human']);
        if (awaitingHuman.length > 0) {
          await artifacts.flush();
          await finalizeRunSafe(storage, graphRun, {
            status: 'blocked',
            reason: `v2 graph awaiting human verification (${awaitingHuman.join(', ')})`,
          });
          const runIndexEntry = await buildLocalRunIndexEntry(storage, graphRun, 'blocked');
          return {
            code: 1,
            decision: makeDecision({
              outcome: 'blocked',
              message: `v2 graph ${graph.id} requires human verification for: ${awaitingHuman.join(', ')}`,
              nextPrompt: 'Complete required human verification and re-run.',
              graph,
            }),
            lastRun: graphRun,
            runIndexEntry,
          };
        }

        if (stalledTicks >= 3) {
          const blockers = unresolvedPendingNodes(graph);
          await artifacts.flush();
          await finalizeRunSafe(storage, graphRun, {
            status: 'blocked',
            reason: `v2 graph stalled: ${blockers.join(', ') || 'no runnable nodes'}`,
          });
          const runIndexEntry = await buildLocalRunIndexEntry(storage, graphRun, 'blocked');
          return {
            code: 1,
            decision: makeDecision({
              outcome: 'blocked',
              message: `v2 graph ${graph.id} stalled; no runnable nodes after ${stalledTicks} ticks.`,
              nextPrompt: blockers.length
                ? `Investigate blocked nodes: ${blockers.join(', ')}`
                : 'Investigate graph dependencies and node statuses.',
              graph,
            }),
            lastRun: graphRun,
            runIndexEntry,
          };
        }
      }

      await artifacts.flush();
      await finalizeRunSafe(storage, graphRun, {
        status: 'failed',
        reason: `v2 graph exceeded max ticks (${maxTicks}).`,
      });
      const runIndexEntry = await buildLocalRunIndexEntry(storage, graphRun, 'failed');
      return {
        code: 1,
        decision: makeDecision({
          outcome: 'failed',
          message: `v2 graph execution exceeded max ticks (${maxTicks}) without completion.`,
          graph,
        }),
        lastRun: graphRun,
        runIndexEntry,
      };
    } catch (err) {
      const message = String(err?.message || err || 'v2 graph execution failed');
      artifacts.recordOutput('V2 Graph Error', message);
      await artifacts.flush();
      if (!graphRun?.finalized) {
        try {
          await storage.failRun(graphRun, {
            error: message,
            code: 'V2_GRAPH_EXECUTION_FAILED',
          });
        } catch { }
      }
      throw err;
    }
  }

  return { runV2GraphExecutionLoop };
}

module.exports = { createCloudExecuteGraphV2 };
