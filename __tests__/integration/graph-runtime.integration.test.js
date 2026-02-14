const { GraphRuntime } = require('../../src/graph/runtime.ts');
const {
    InMemoryGraphStore,
    GraphVersionConflictError,
} = require('../../src/graph/store.ts');

class FakePgBoss {
    constructor(options = {}) {
        this.autoRun = options.autoRun !== false;
        this.started = false;
        this.handlers = new Map();
        this.queues = new Map();
        this.nextJobId = 1;
    }

    async start() {
        this.started = true;
        if (this.autoRun) {
            await this.drain();
        }
    }

    async stop() {
        this.started = false;
    }

    async work(queueName, optionsOrHandler, maybeHandler) {
        const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
        this.handlers.set(queueName, handler);
        if (this.autoRun && this.started) {
            await this.drain();
        }
    }

    async send(queueName, data, options = {}) {
        const queue = this.queues.get(queueName) || [];
        const singletonKey = options.singletonKey;

        if (singletonKey && queue.some((job) => job.options && job.options.singletonKey === singletonKey)) {
            return null;
        }

        queue.push({
            id: String(this.nextJobId++),
            name: queueName,
            data,
            options,
        });
        this.queues.set(queueName, queue);

        if (this.autoRun && this.started) {
            await this.drain();
        }

        return queue[queue.length - 1].id;
    }

    pendingCount(queueName) {
        if (queueName) {
            return (this.queues.get(queueName) || []).length;
        }

        let count = 0;
        for (const queue of this.queues.values()) {
            count += queue.length;
        }
        return count;
    }

    async drain(maxJobs = 200) {
        let processed = 0;

        while (this.started && processed < maxJobs) {
            let nextQueueName = null;
            for (const [queueName, queue] of this.queues.entries()) {
                if (queue.length > 0 && this.handlers.has(queueName)) {
                    nextQueueName = queueName;
                    break;
                }
            }

            if (!nextQueueName) {
                break;
            }

            const queue = this.queues.get(nextQueueName);
            const job = queue.shift();
            const handler = this.handlers.get(nextQueueName);

            await handler(job);
            processed += 1;
        }

        return processed;
    }
}

class ConflictOnceStore extends InMemoryGraphStore {
    constructor(options = {}) {
        super(options);
        this.conflictCount = 0;
        this.injectedGraphIds = new Set();
    }

    async replaceGraph(graphId, nextGraph, options = {}) {
        if (!this.injectedGraphIds.has(graphId)) {
            this.injectedGraphIds.add(graphId);
            this.conflictCount += 1;

            const current = await this.getGraph(graphId);
            if (current) {
                await super.replaceGraph(graphId, current, {
                    ifMatchGraphVersion: current.graphVersion,
                });
            }

            throw new GraphVersionConflictError('Injected conflict for test', {
                graphId,
                expectedVersion: options.ifMatchGraphVersion,
            });
        }

        return super.replaceGraph(graphId, nextGraph, options);
    }
}

function createGraph(graphId, overrides = {}) {
    const now = new Date().toISOString();

    return {
        id: graphId,
        taskId: `task-${graphId}`,
        graphVersion: 1,
        mode: 'PROJECT',
        policy: {
            maxConcurrent: 1,
            nodeTimeoutMs: 60_000,
            graphTimeoutMs: 24 * 60 * 60 * 1000,
            ...(overrides.policy || {}),
        },
        nodes: {
            n1: {
                type: 'work',
                status: 'pending',
                deps: [],
                output: { seed: `seed-${graphId}` },
                ...(overrides.node || {}),
            },
        },
        edges: [],
        doneCriteria: {
            allRequiredGatesPassed: true,
            noRunnableOrPendingWork: true,
        },
        createdAt: overrides.createdAt || now,
        updatedAt: overrides.updatedAt || now,
        ...overrides,
    };
}

describe('graph runtime integration', () => {
    it('scheduler restart resumes all in-progress graphs without data loss', async () => {
        const store = new InMemoryGraphStore();
        await store.createGraph(createGraph('g1'));
        await store.createGraph(createGraph('g2'));

        const scheduler = {
            tick: async (graph, { now }) => {
                const node = graph.nodes.n1;
                if (node.status === 'pending') {
                    node.status = 'running';
                    node.startedAt = now;
                    return { graph, events: [] };
                }

                if (node.status === 'running') {
                    node.status = 'done';
                    node.completedAt = now;
                    node.output = {
                        ...node.output,
                        completedAt: now,
                    };
                }

                return { graph, events: [] };
            },
        };

        const boss1 = new FakePgBoss({ autoRun: false });
        const runtime1 = new GraphRuntime({
            store,
            boss: boss1,
            scheduler,
            tickDelayMs: 0,
            queueName: 'graph.tick.resume',
        });

        await runtime1.start();
        await boss1.drain(2);
        await runtime1.stop();

        const midGraph1 = await store.getGraph('g1');
        const midGraph2 = await store.getGraph('g2');
        expect(midGraph1.nodes.n1.status).toBe('running');
        expect(midGraph2.nodes.n1.status).toBe('running');

        const boss2 = new FakePgBoss({ autoRun: false });
        const runtime2 = new GraphRuntime({
            store,
            boss: boss2,
            scheduler,
            tickDelayMs: 0,
            queueName: 'graph.tick.resume',
        });

        await runtime2.start();
        await boss2.drain(10);

        const doneGraph1 = await store.getGraph('g1');
        const doneGraph2 = await store.getGraph('g2');

        expect(doneGraph1.nodes.n1.status).toBe('done');
        expect(doneGraph2.nodes.n1.status).toBe('done');
        expect(doneGraph1.nodes.n1.output.seed).toBe('seed-g1');
        expect(doneGraph2.nodes.n1.output.seed).toBe('seed-g2');
        expect(doneGraph1.nodes.n1.output.completedAt).toBeTruthy();
        expect(doneGraph2.nodes.n1.output.completedAt).toBeTruthy();

        await runtime2.stop();
    });

    it('detects version conflicts and retries instead of dropping mutations', async () => {
        const store = new ConflictOnceStore();
        await store.createGraph(createGraph('conflict'));

        const scheduler = {
            tick: async (graph, { now }) => {
                const node = graph.nodes.n1;
                if (node.status === 'pending') {
                    node.status = 'done';
                    node.completedAt = now;
                }
                return { graph, events: [] };
            },
        };

        const boss = new FakePgBoss({ autoRun: false });
        const runtime = new GraphRuntime({
            store,
            boss,
            scheduler,
            tickDelayMs: 0,
            conflictRetryDelayMs: 0,
            maxConflictRetries: 4,
            queueName: 'graph.tick.conflict',
            logger: { warn: jest.fn() },
        });

        await runtime.start();
        await boss.drain(10);

        const graph = await store.getGraph('conflict');
        expect(store.conflictCount).toBe(1);
        expect(graph.nodes.n1.status).toBe('done');
        expect(graph.graphVersion).toBeGreaterThanOrEqual(3);

        await runtime.stop();
    });

    it('persists node_status and budget_consumed events to graph_events', async () => {
        const store = new InMemoryGraphStore();
        await store.createGraph(createGraph('events'));

        const scheduler = {
            tick: async (graph, { now }) => {
                const node = graph.nodes.n1;
                const events = [];

                if (node.status === 'pending') {
                    node.status = 'running';
                    node.startedAt = now;
                    events.push({
                        eventType: 'budget_consumed',
                        budgetType: 'verify',
                        remaining: 2,
                        triggerNodeId: 'n1',
                    });
                } else if (node.status === 'running') {
                    node.status = 'done';
                    node.completedAt = now;
                }

                return { graph, events };
            },
        };

        const boss = new FakePgBoss({ autoRun: false });
        const runtime = new GraphRuntime({
            store,
            boss,
            scheduler,
            tickDelayMs: 0,
            queueName: 'graph.tick.events',
        });

        await runtime.start();
        await boss.drain(10);

        const events = await store.getEvents('events');
        const eventTypes = events.map((event) => event.eventType);

        expect(eventTypes).toContain('node_status');
        expect(eventTypes).toContain('budget_consumed');
        expect(events.filter((event) => event.eventType === 'node_status').length).toBeGreaterThanOrEqual(2);

        await runtime.stop();
    });

    it('enforces graph timeout using persisted timestamps', async () => {
        const store = new InMemoryGraphStore();
        const staleCreatedAt = new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString();

        await store.createGraph(createGraph('timeout', {
            createdAt: staleCreatedAt,
            policy: {
                graphTimeoutMs: 500,
                nodeTimeoutMs: 1000,
            },
        }));

        const scheduler = {
            tick: jest.fn(async (graph) => ({ graph, events: [] })),
        };

        const boss = new FakePgBoss({ autoRun: false });
        const runtime = new GraphRuntime({
            store,
            boss,
            scheduler,
            tickDelayMs: 0,
            queueName: 'graph.tick.timeout',
        });

        await runtime.start();
        await boss.drain(10);

        const timedOutGraph = await store.getGraph('timeout');
        expect(timedOutGraph.timedOutAt).toBeTruthy();
        expect(timedOutGraph.completedAt).toBeTruthy();
        expect(timedOutGraph.nodes.n1.status).toBe('failed');
        expect(scheduler.tick).not.toHaveBeenCalled();

        const events = await store.getEvents('timeout');
        expect(events.some((event) => event.eventType === 'node_status')).toBe(true);

        await runtime.stop();
    });
});
