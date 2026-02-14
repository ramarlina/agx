const { INCOMPLETE_FOR_DONE_STATUSES, SUCCESS_NODE_STATUSES } = require('./types');

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function defaultNow() {
    return new Date().toISOString();
}

function canRunNode(graph, nodeId) {
    const node = graph.nodes[nodeId];
    if (!node || !Array.isArray(node.deps)) {
        return true;
    }

    return node.deps.every((depId) => {
        const dep = graph.nodes[depId];
        if (!dep) {
            return false;
        }

        return SUCCESS_NODE_STATUSES.includes(dep.status);
    });
}

function tick(graph, options = {}) {
    const now = options.now || defaultNow();
    const nextGraph = deepClone(graph);
    const events = [];

    const maxConcurrent = Number.isInteger(nextGraph.policy && nextGraph.policy.maxConcurrent)
        ? Math.max(1, nextGraph.policy.maxConcurrent)
        : 1;

    const runningWorkNodeIds = Object.keys(nextGraph.nodes).filter((nodeId) => {
        const node = nextGraph.nodes[nodeId];
        return node && node.type === 'work' && node.status === 'running';
    });

    for (const nodeId of runningWorkNodeIds) {
        const node = nextGraph.nodes[nodeId];
        const previous = node.status;
        node.status = 'done';
        node.completedAt = now;
        events.push({
            eventType: 'node_status',
            nodeId,
            fromStatus: previous,
            toStatus: node.status,
            timestamp: now,
            reason: 'scheduler_tick_complete',
        });
    }

    const availableSlots = Math.max(0, maxConcurrent - runningWorkNodeIds.length);
    if (availableSlots <= 0) {
        return { graph: nextGraph, events };
    }

    const pendingNodeIds = Object.keys(nextGraph.nodes).filter((nodeId) => {
        const node = nextGraph.nodes[nodeId];
        if (!node || node.status !== 'pending') {
            return false;
        }

        if (!INCOMPLETE_FOR_DONE_STATUSES.includes(node.status)) {
            return false;
        }

        if (node.type !== 'work' && node.type !== 'gate') {
            return false;
        }

        return canRunNode(nextGraph, nodeId);
    });

    for (const nodeId of pendingNodeIds.slice(0, availableSlots)) {
        const node = nextGraph.nodes[nodeId];
        const previous = node.status;
        node.status = 'running';
        node.startedAt = node.startedAt || now;
        events.push({
            eventType: 'node_status',
            nodeId,
            fromStatus: previous,
            toStatus: node.status,
            timestamp: now,
            reason: 'deps_satisfied',
        });
    }

    return { graph: nextGraph, events };
}

module.exports = {
    tick,
};
