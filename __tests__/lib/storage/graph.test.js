/**
 * Tests for lib/storage/graph.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const originalEnv = { ...process.env };

describe('lib/storage/graph', () => {
    let testDir;
    let graphStorage;
    let paths;

    beforeEach(async () => {
        testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agx-graph-storage-test-'));
        process.env.AGX_HOME = testDir;

        jest.resetModules();
        graphStorage = require('../../../lib/storage/graph');
        paths = require('../../../lib/storage/paths');
    });

    afterEach(async () => {
        try {
            await fs.promises.rm(testDir, { recursive: true, force: true });
        } catch {
            // ignore cleanup errors
        }
        process.env = { ...originalEnv };
    });

    function sampleGraph(taskId = 'task-1') {
        return {
            id: 'graph-1',
            taskId,
            graphVersion: 1,
            mode: 'PROJECT',
            nodes: {
                'work-main': {
                    type: 'work',
                    status: 'pending',
                    deps: [],
                    title: 'Implement feature',
                    attempts: 0,
                    maxAttempts: 2,
                    retryPolicy: {
                        backoffMs: 5000,
                        onExhaust: 'escalate',
                    },
                },
            },
            edges: [],
            policy: {
                maxConcurrent: 3,
            },
            doneCriteria: {
                allRequiredGatesPassed: true,
                noRunnableOrPendingWork: true,
            },
            versionHistory: [],
            runtimeEvents: [],
            createdAt: '2026-02-14T00:00:00.000Z',
            updatedAt: '2026-02-14T00:00:00.000Z',
        };
    }

    it('writeTaskGraph persists graph.json and readTaskGraph round-trips', async () => {
        const projectSlug = 'my-project';
        const taskSlug = 'my-task';
        const graph = sampleGraph();

        await graphStorage.writeTaskGraph(projectSlug, taskSlug, graph);

        const filePath = paths.graphJsonPath(projectSlug, taskSlug);
        expect(fs.existsSync(filePath)).toBe(true);

        const loaded = await graphStorage.readTaskGraph(projectSlug, taskSlug);
        expect(loaded).toEqual(graph);
    });

    it('readTaskGraph returns null for missing graph', async () => {
        const loaded = await graphStorage.readTaskGraph('my-project', 'missing-task');
        expect(loaded).toBeNull();
    });

    it('deleteTaskGraph removes graph file and is idempotent', async () => {
        const projectSlug = 'my-project';
        const taskSlug = 'my-task';
        const graph = sampleGraph();

        await graphStorage.writeTaskGraph(projectSlug, taskSlug, graph);
        const filePath = paths.graphJsonPath(projectSlug, taskSlug);
        expect(fs.existsSync(filePath)).toBe(true);

        await graphStorage.deleteTaskGraph(projectSlug, taskSlug);
        expect(fs.existsSync(filePath)).toBe(false);

        await expect(graphStorage.deleteTaskGraph(projectSlug, taskSlug)).resolves.toBeUndefined();
    });

    it('writeTaskGraph validates required graph shape', async () => {
        await expect(
            graphStorage.writeTaskGraph('my-project', 'my-task', { id: 'graph-1' })
        ).rejects.toThrow(/graph\.taskId is required/);

        await expect(
            graphStorage.writeTaskGraph('my-project', 'my-task', {
                id: 'graph-1',
                taskId: 'task-1',
                nodes: {},
                edges: {},
            })
        ).rejects.toThrow(/graph\.edges must be an array/);
    });
});
