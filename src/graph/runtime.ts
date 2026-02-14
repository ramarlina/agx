const { tick: schedulerTick } = require('./scheduler');
const {
    GraphVersionConflictError,
    isGraphInProgress,
} = require('./store');
const { INCOMPLETE_FOR_DONE_STATUSES } = require('./types');

const DEFAULT_TICK_QUEUE = 'agx.graph.tick';
const DEFAULT_TICK_DELAY_MS = 100;
const DEFAULT_MAX_CONFLICT_RETRIES = 3;
const DEFAULT_CONFLICT_RETRY_DELAY_MS = 20;
const DEFAULT_NODE_TIMEOUT_SECONDS = 30 * 60;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function toIso(value) {
    if (!value) {
        return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed.toISOString();
}

function statusEventKey(event) {
    return `${event.nodeId}:${event.fromStatus}:${event.toStatus}`;
}

function deriveNodeStatusEvents(beforeGraph, afterGraph, timestamp) {
    const byKey = new Map();

    const beforeNodes = beforeGraph && beforeGraph.nodes ? beforeGraph.nodes : {};
    const afterNodes = afterGraph && afterGraph.nodes ? afterGraph.nodes : {};
    const allNodeIds = new Set([...Object.keys(beforeNodes), ...Object.keys(afterNodes)]);

    for (const nodeId of allNodeIds) {
        const before = beforeNodes[nodeId];
        const after = afterNodes[nodeId];

        if (!before || !after) {
            continue;
        }

        const fromStatus = before.status;
        const toStatus = after.status;
        if (fromStatus === toStatus) {
            continue;
        }

        const event = {
            eventType: 'node_status',
            nodeId,
            fromStatus,
            toStatus,
            timestamp,
        };

        byKey.set(statusEventKey(event), event);
    }

    return Array.from(byKey.values());
}

function collectBudgetEvents(events, timestamp) {
    if (!Array.isArray(events)) {
        return [];
    }

    return events
        .filter((event) => event && event.eventType === 'budget_consumed')
        .map((event) => {
            const normalized = deepClone(event);
            normalized.timestamp = normalized.timestamp || timestamp;
            return normalized;
        });
}

function normalizeRuntimeEvent(event, graphId, timestamp) {
    const normalized = deepClone(event);
    normalized.graphId = normalized.graphId || graphId;
    normalized.timestamp = normalized.timestamp || timestamp;
    return normalized;
}

function graphStartTimestamp(graph) {
    return toIso(graph.startedAt) || toIso(graph.createdAt) || toIso(graph.updatedAt);
}

function enforceGraphTimeout(graph, nowIso) {
    const timeoutMs = Number(graph && graph.policy && graph.policy.graphTimeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return false;
    }

    if (graph.timedOutAt || graph.completedAt) {
        return false;
    }

    const startTs = graphStartTimestamp(graph);
    if (!startTs) {
        return false;
    }

    const elapsedMs = Date.parse(nowIso) - Date.parse(startTs);
    if (!Number.isFinite(elapsedMs) || elapsedMs < timeoutMs) {
        return false;
    }

    graph.timedOutAt = nowIso;
    graph.completedAt = graph.completedAt || nowIso;
    graph.status = 'timed_out';

    if (graph.nodes && typeof graph.nodes === 'object') {
        for (const node of Object.values(graph.nodes)) {
            if (!node || !INCOMPLETE_FOR_DONE_STATUSES.includes(node.status)) {
                continue;
            }

            node.status = node.type === 'gate' ? 'failed' : 'failed';
            node.completedAt = node.completedAt || nowIso;
            node.error = node.error || 'graph_timeout';
        }
    }

    return true;
}

function resolveTickHandler(scheduler) {
    if (!scheduler) {
        return schedulerTick;
    }
    if (typeof scheduler === 'function') {
        return scheduler;
    }
    if (typeof scheduler.tick === 'function') {
        return scheduler.tick.bind(scheduler);
    }
    throw new Error('scheduler must be a function or expose tick(graph, options)');
}

function resolveExpireInSeconds(graph, fallbackSeconds) {
    const ms = Number(graph && graph.policy && graph.policy.nodeTimeoutMs);
    if (!Number.isFinite(ms) || ms <= 0) {
        return fallbackSeconds;
    }

    return Math.max(1, Math.ceil(ms / 1000));
}

function createPgBoss(connectionString, options) {
    // Lazy require so tests can run without a live Postgres connection.
    // pg-boss still needs to be installed as a dependency for production runtime.
    // eslint-disable-next-line global-require
    const PgBoss = require('pg-boss');
    return new PgBoss(connectionString, options || {});
}

class GraphRuntime {
    constructor(options = {}) {
        if (!options.store) {
            throw new Error('GraphRuntime requires a store');
        }

        this.store = options.store;
        this.schedulerTick = resolveTickHandler(options.scheduler);
        this.queueName = options.queueName || DEFAULT_TICK_QUEUE;
        this.tickDelayMs = Number.isFinite(options.tickDelayMs) ? options.tickDelayMs : DEFAULT_TICK_DELAY_MS;
        this.maxConflictRetries = Number.isInteger(options.maxConflictRetries)
            ? Math.max(0, options.maxConflictRetries)
            : DEFAULT_MAX_CONFLICT_RETRIES;
        this.conflictRetryDelayMs = Number.isFinite(options.conflictRetryDelayMs)
            ? Math.max(0, options.conflictRetryDelayMs)
            : DEFAULT_CONFLICT_RETRY_DELAY_MS;
        this.defaultExpireInSeconds = Number.isFinite(options.defaultExpireInSeconds)
            ? Math.max(1, options.defaultExpireInSeconds)
            : DEFAULT_NODE_TIMEOUT_SECONDS;
        this.now = typeof options.now === 'function' ? options.now : () => new Date();
        this.logger = options.logger || console;

        this.boss = options.boss || createPgBoss(options.connectionString, options.pgBossOptions);
        this._workerRegistered = false;
        this._started = false;
    }

    async start() {
        if (this._started) {
            return;
        }

        if (typeof this.boss.start === 'function') {
            await this.boss.start();
        }

        await this._registerWorker();
        await this.recoverInProgressGraphs();

        this._started = true;
    }

    async stop() {
        if (!this._started) {
            return;
        }

        if (typeof this.boss.stop === 'function') {
            await this.boss.stop();
        }

        this._started = false;
    }

    async recoverInProgressGraphs() {
        const graphs = await this.store.listInProgressGraphs();
        for (const graph of graphs) {
            await this.enqueueTick(graph.id, {
                expireInSeconds: resolveExpireInSeconds(graph, this.defaultExpireInSeconds),
            });
        }
        return graphs.length;
    }

    async enqueueTick(graphId, options = {}) {
        if (!graphId) {
            throw new Error('graphId is required');
        }

        const graph = await this.store.getGraph(graphId);
        if (!graph) {
            return null;
        }

        const expireInSeconds = Number.isFinite(options.expireInSeconds)
            ? Math.max(1, options.expireInSeconds)
            : resolveExpireInSeconds(graph, this.defaultExpireInSeconds);

        return this.boss.send(
            this.queueName,
            { graphId },
            {
                singletonKey: graphId,
                expireInSeconds,
            }
        );
    }

    async _registerWorker() {
        if (this._workerRegistered) {
            return;
        }

        const jobHandler = async (jobOrJobs) => {
            if (Array.isArray(jobOrJobs)) {
                for (const job of jobOrJobs) {
                    await this._processTickJob(job);
                }
                return;
            }

            await this._processTickJob(jobOrJobs);
        };

        await this.boss.work(this.queueName, { batchSize: 1 }, jobHandler);
        this._workerRegistered = true;
    }

    async _processTickJob(job) {
        const graphId = job && job.data ? job.data.graphId : null;
        if (!graphId) {
            return;
        }

        const result = await this._tickWithOptimisticRetry(graphId);
        if (!result || !result.persistedGraph || !result.shouldContinue) {
            return;
        }

        if (this.tickDelayMs > 0) {
            await sleep(this.tickDelayMs);
        }

        await this.enqueueTick(graphId, {
            expireInSeconds: resolveExpireInSeconds(result.persistedGraph, this.defaultExpireInSeconds),
        });
    }

    async _tickWithOptimisticRetry(graphId) {
        let attempt = 0;

        while (attempt <= this.maxConflictRetries) {
            attempt += 1;

            const currentGraph = await this.store.getGraph(graphId);
            if (!currentGraph) {
                return null;
            }

            const nowIso = this.now().toISOString();
            const preTickGraph = deepClone(currentGraph);
            const nextGraph = deepClone(currentGraph);

            const timedOut = enforceGraphTimeout(nextGraph, nowIso);

            let schedulerEvents = [];
            if (!timedOut) {
                const tickResult = await this.schedulerTick(nextGraph, { now: nowIso });
                if (tickResult && tickResult.graph) {
                    Object.assign(nextGraph, tickResult.graph);
                }
                schedulerEvents = (tickResult && Array.isArray(tickResult.events)) ? tickResult.events : [];
            }

            const nodeStatusEvents = deriveNodeStatusEvents(preTickGraph, nextGraph, nowIso);
            const budgetEvents = collectBudgetEvents(schedulerEvents, nowIso);
            const eventsToPersist = [...nodeStatusEvents, ...budgetEvents]
                .map((event) => normalizeRuntimeEvent(event, graphId, nowIso));

            try {
                const persistedGraph = await this.store.replaceGraph(graphId, nextGraph, {
                    ifMatchGraphVersion: currentGraph.graphVersion,
                });

                for (const event of eventsToPersist) {
                    if (event.eventType === 'node_status' || event.eventType === 'budget_consumed') {
                        await this.store.appendEvent(graphId, event);
                    }
                }

                return {
                    persistedGraph,
                    shouldContinue: isGraphInProgress(persistedGraph),
                };
            } catch (error) {
                const isConflict = error instanceof GraphVersionConflictError
                    || error.name === 'GraphVersionConflictError'
                    || error.code === 'GRAPH_VERSION_CONFLICT';

                if (!isConflict) {
                    throw error;
                }

                if (attempt > this.maxConflictRetries) {
                    throw error;
                }

                if (this.logger && typeof this.logger.warn === 'function') {
                    this.logger.warn('[graph-runtime] Version conflict, retrying tick', {
                        graphId,
                        attempt,
                    });
                }

                if (this.conflictRetryDelayMs > 0) {
                    await sleep(this.conflictRetryDelayMs * attempt);
                }
            }
        }

        return null;
    }
}

module.exports = {
    GraphRuntime,
    enforceGraphTimeout,
    deriveNodeStatusEvents,
    collectBudgetEvents,
};
