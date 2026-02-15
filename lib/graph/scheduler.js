const {
  FAILURE_NODE_STATUSES,
  INCOMPLETE_FOR_DONE_STATUSES,
  SOFT_DEP_SATISFIED_STATUSES,
  SUCCESS_NODE_STATUSES,
  TERMINAL_NODE_STATUSES
} = require("./types");
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
function defaultNow() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function findDependencyEdge(graph, depId, nodeId) {
  if (!graph || !Array.isArray(graph.edges)) {
    return null;
  }
  return graph.edges.find((edge) => edge && edge.from === depId && edge.to === nodeId) || null;
}
function isDependencySatisfied(graph, depId, nodeId) {
  const dep = graph.nodes[depId];
  if (!dep) {
    return false;
  }
  const edge = findDependencyEdge(graph, depId, nodeId) || {
    type: "hard",
    condition: "on_success"
  };
  const edgeCondition = edge.condition || "on_success";
  if (edge.type === "soft") {
    return SOFT_DEP_SATISFIED_STATUSES.includes(dep.status);
  }
  if (edgeCondition === "on_failure") {
    return FAILURE_NODE_STATUSES.includes(dep.status);
  }
  if (edgeCondition === "always") {
    return TERMINAL_NODE_STATUSES.includes(dep.status);
  }
  return SUCCESS_NODE_STATUSES.includes(dep.status);
}
function canRunNode(graph, nodeId) {
  const node = graph.nodes[nodeId];
  if (!node || !Array.isArray(node.deps)) {
    return true;
  }
  return node.deps.every((depId) => isDependencySatisfied(graph, depId, nodeId));
}
function tick(graph, options = {}) {
  const now = options.now || defaultNow();
  const nextGraph = deepClone(graph);
  const events = [];
  const maxConcurrent = Number.isInteger(nextGraph.policy && nextGraph.policy.maxConcurrent) ? Math.max(1, nextGraph.policy.maxConcurrent) : 1;
  const runningWorkNodeCount = Object.keys(nextGraph.nodes).filter((nodeId) => {
    const node = nextGraph.nodes[nodeId];
    return node && node.type === "work" && node.status === "running";
  }).length;
  const pendingRunnableGateNodeIds = [];
  const pendingRunnableWorkNodeIds = [];
  for (const nodeId of Object.keys(nextGraph.nodes)) {
    const node = nextGraph.nodes[nodeId];
    if (!node || node.status !== "pending") {
      continue;
    }
    if (!INCOMPLETE_FOR_DONE_STATUSES.includes(node.status)) {
      continue;
    }
    if (node.type !== "work" && node.type !== "gate") {
      continue;
    }
    if (!canRunNode(nextGraph, nodeId)) {
      continue;
    }
    if (node.type === "gate") {
      pendingRunnableGateNodeIds.push(nodeId);
    } else {
      pendingRunnableWorkNodeIds.push(nodeId);
    }
  }
  for (const nodeId of pendingRunnableGateNodeIds) {
    const node = nextGraph.nodes[nodeId];
    const previous = node.status;
    node.status = "running";
    node.startedAt = node.startedAt || now;
    events.push({
      eventType: "node_status",
      nodeId,
      fromStatus: previous,
      toStatus: node.status,
      timestamp: now,
      reason: "deps_satisfied"
    });
  }
  const availableWorkSlots = Math.max(0, maxConcurrent - runningWorkNodeCount);
  for (const nodeId of pendingRunnableWorkNodeIds.slice(0, availableWorkSlots)) {
    const node = nextGraph.nodes[nodeId];
    const previous = node.status;
    node.status = "running";
    node.startedAt = node.startedAt || now;
    events.push({
      eventType: "node_status",
      nodeId,
      fromStatus: previous,
      toStatus: node.status,
      timestamp: now,
      reason: "deps_satisfied"
    });
  }
  return { graph: nextGraph, events };
}
module.exports = {
  tick
};
