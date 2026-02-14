const { isIncompleteStatus } = require('./types');

function nowIso() {
    return new Date().toISOString();
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function hasInProgressNodes(graph) {
    if (!graph || !graph.nodes || typeof graph.nodes !== 'object') {
        return false;
    }

    return Object.values(graph.nodes).some((node) => {
        return node && typeof node.status === 'string' && isIncompleteStatus(node.status);
    });
}

class GraphVersionConflictError extends Error {
    constructor(message, details = {}) {
        super(message || 'Graph version conflict');
        this.name = 'GraphVersionConflictError';
        this.code = 'GRAPH_VERSION_CONFLICT';
        this.details = details;
    }
}

class InMemoryGraphStore {
    constructor(options = {}) {
        this.graphs = new Map();
        this.graphEvents = new Map();

        const graphs = Array.isArray(options.graphs) ? options.graphs : [];
        for (const graph of graphs) {
            this.createGraph(graph);
        }
    }

    async createGraph(graph) {
        if (!graph || typeof graph !== 'object') {
            throw new Error('graph must be an object');
        }
        if (!graph.id) {
            throw new Error('graph.id is required');
        }

        const ts = nowIso();
        const persisted = deepClone(graph);
        persisted.graphVersion = Number.isInteger(persisted.graphVersion) ? persisted.graphVersion : 1;
        persisted.createdAt = persisted.createdAt || ts;
        persisted.updatedAt = persisted.updatedAt || ts;

        this.graphs.set(persisted.id, persisted);
        if (!this.graphEvents.has(persisted.id)) {
            this.graphEvents.set(persisted.id, []);
        }

        return deepClone(persisted);
    }

    async getGraph(graphId) {
        const graph = this.graphs.get(graphId);
        return graph ? deepClone(graph) : null;
    }

    async listInProgressGraphs() {
        const inProgress = [];

        for (const graph of this.graphs.values()) {
            if (isGraphInProgress(graph)) {
                inProgress.push(deepClone(graph));
            }
        }

        return inProgress;
    }

    async replaceGraph(graphId, nextGraph, options = {}) {
        const current = this.graphs.get(graphId);
        if (!current) {
            throw new Error(`Graph not found: ${graphId}`);
        }

        const expectedVersion = options.ifMatchGraphVersion;
        if (Number.isInteger(expectedVersion) && expectedVersion !== current.graphVersion) {
            throw new GraphVersionConflictError('ifMatchGraphVersion mismatch', {
                graphId,
                expectedVersion,
                actualVersion: current.graphVersion,
            });
        }

        const ts = nowIso();
        const persisted = deepClone(nextGraph);
        persisted.id = graphId;
        persisted.createdAt = current.createdAt || persisted.createdAt || ts;
        persisted.updatedAt = ts;
        persisted.graphVersion = current.graphVersion + 1;

        this.graphs.set(graphId, persisted);
        if (!this.graphEvents.has(graphId)) {
            this.graphEvents.set(graphId, []);
        }

        return deepClone(persisted);
    }

    async appendEvent(graphId, event) {
        if (!this.graphEvents.has(graphId)) {
            this.graphEvents.set(graphId, []);
        }

        const events = this.graphEvents.get(graphId);
        const toPersist = deepClone(event);
        toPersist.persistedAt = nowIso();
        events.push(toPersist);

        return deepClone(toPersist);
    }

    async getEvents(graphId) {
        return deepClone(this.graphEvents.get(graphId) || []);
    }
}

function isGraphInProgress(graph) {
    if (!graph || typeof graph !== 'object') {
        return false;
    }

    if (graph.timedOutAt || graph.completedAt) {
        return false;
    }

    return hasInProgressNodes(graph);
}

module.exports = {
    GraphVersionConflictError,
    InMemoryGraphStore,
    isGraphInProgress,
};
