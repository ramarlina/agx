const { tick } = require('../../src/graph/scheduler.ts');

function baseGraph(overrides = {}) {
    return {
        id: 'graph-1',
        taskId: 'task-1',
        graphVersion: 1,
        mode: 'PROJECT',
        policy: {
            maxConcurrent: 1,
            ...(overrides.policy || {}),
        },
        nodes: {
            ...(overrides.nodes || {}),
        },
        edges: Array.isArray(overrides.edges) ? overrides.edges : [],
        doneCriteria: {
            allRequiredGatesPassed: true,
            noRunnableOrPendingWork: true,
            ...(overrides.doneCriteria || {}),
        },
        ...overrides,
    };
}

describe('graph scheduler integration', () => {
    it('does not auto-complete running work nodes during a scheduling tick', () => {
        const graph = baseGraph({
            nodes: {
                runningWork: {
                    type: 'work',
                    status: 'running',
                    deps: [],
                },
            },
        });

        const result = tick(graph, { now: '2026-02-14T00:00:00.000Z' });

        expect(result.graph.nodes.runningWork.status).toBe('running');
        expect(result.events).toEqual([]);
    });

    it('evaluates hard/soft edge conditions for dependency readiness', () => {
        const graph = baseGraph({
            policy: { maxConcurrent: 4 },
            nodes: {
                depFailed: { type: 'work', status: 'failed', deps: [] },
                depDone: { type: 'work', status: 'done', deps: [] },
                depBlocked: { type: 'work', status: 'blocked', deps: [] },
                onFailureWork: { type: 'work', status: 'pending', deps: ['depFailed'] },
                alwaysWork: { type: 'work', status: 'pending', deps: ['depFailed'] },
                softWork: { type: 'work', status: 'pending', deps: ['depBlocked'] },
                shouldStayPending: { type: 'work', status: 'pending', deps: ['depFailed'] },
                onSuccessGate: { type: 'gate', status: 'pending', deps: ['depDone'] },
            },
            edges: [
                { from: 'depFailed', to: 'onFailureWork', type: 'hard', condition: 'on_failure' },
                { from: 'depFailed', to: 'alwaysWork', type: 'hard', condition: 'always' },
                { from: 'depBlocked', to: 'softWork', type: 'soft', condition: 'on_success' },
                { from: 'depFailed', to: 'shouldStayPending', type: 'hard', condition: 'on_success' },
                { from: 'depDone', to: 'onSuccessGate', type: 'hard', condition: 'on_success' },
            ],
        });

        const result = tick(graph, { now: '2026-02-14T00:00:00.000Z' });

        expect(result.graph.nodes.onFailureWork.status).toBe('running');
        expect(result.graph.nodes.alwaysWork.status).toBe('running');
        expect(result.graph.nodes.softWork.status).toBe('running');
        expect(result.graph.nodes.onSuccessGate.status).toBe('running');
        expect(result.graph.nodes.shouldStayPending.status).toBe('pending');
    });

    it('applies maxConcurrent only to work nodes and still dispatches runnable gates', () => {
        const graph = baseGraph({
            policy: { maxConcurrent: 1 },
            nodes: {
                runningWork: { type: 'work', status: 'running', deps: [] },
                pendingWork: { type: 'work', status: 'pending', deps: [] },
                pendingGate: { type: 'gate', status: 'pending', deps: [] },
            },
        });

        const result = tick(graph, { now: '2026-02-14T00:00:00.000Z' });

        expect(result.graph.nodes.runningWork.status).toBe('running');
        expect(result.graph.nodes.pendingWork.status).toBe('pending');
        expect(result.graph.nodes.pendingGate.status).toBe('running');
        expect(result.events.map((event) => event.nodeId)).toEqual(['pendingGate']);
    });

    it('limits runnable dispatch to explicitly allowed node ids', () => {
        const graph = baseGraph({
            policy: { maxConcurrent: 3 },
            nodes: {
                workerA: { type: 'work', status: 'pending', deps: [] },
                workerB: { type: 'work', status: 'pending', deps: [] },
                gateA: { type: 'gate', status: 'pending', deps: [] },
            },
        });

        const result = tick(graph, {
            now: '2026-02-14T00:00:00.000Z',
            allowedNodeIds: ['workerB'],
        });

        expect(result.graph.nodes.workerA.status).toBe('pending');
        expect(result.graph.nodes.workerB.status).toBe('running');
        expect(result.graph.nodes.gateA.status).toBe('pending');
        expect(result.events.map((event) => event.nodeId)).toEqual(['workerB']);
    });
});
