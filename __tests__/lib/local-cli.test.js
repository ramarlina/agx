/**
 * Tests for lib/local-cli.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Store original env
const originalEnv = { ...process.env };

describe('lib/local-cli', () => {
    let testDir;
    let localCli;
    let storage;

    beforeEach(async () => {
        // Create temp directory for each test
        testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agx-local-cli-test-'));
        process.env.AGX_HOME = testDir;

        // Clear module cache to pick up new AGX_HOME
        jest.resetModules();
        localCli = require('../../lib/local-cli');
        storage = require('../../lib/storage');

        // Suppress console output during tests
        jest.spyOn(console, 'log').mockImplementation(() => { });
    });

    afterEach(async () => {
        // Restore console
        jest.restoreAllMocks();

        // Clean up
        try {
            await fs.promises.rm(testDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
        process.env = { ...originalEnv };
    });

    describe('detectProject', () => {
        it('uses folder name when no git repo', async () => {
            const result = await localCli.detectProject(testDir);
            expect(result.projectSlug).toBeDefined();
            expect(result.repoPath).toBe(testDir);
        });

        it('finds git repo root', async () => {
            // Create a fake git repo
            const gitDir = path.join(testDir, '.git');
            await fs.promises.mkdir(gitDir, { recursive: true });

            const result = await localCli.detectProject(testDir);
            expect(result.repoPath).toBe(testDir);
        });
    });

    describe('cmdNew', () => {
        it('creates a new task', async () => {
            const result = await localCli.cmdNew({
                userRequest: 'Build a feature',
                projectSlug: 'test-project',
                json: true,
            });

            expect(result.task).toBeDefined();
            expect(result.task.user_request).toBe('Build a feature');
            expect(result.task.status).toBe('pending');
        });

        it('throws without userRequest', async () => {
            await expect(localCli.cmdNew({ projectSlug: 'test' }))
                .rejects.toThrow(/required/);
        });

        it('initializes working set', async () => {
            const result = await localCli.cmdNew({
                userRequest: 'Test task',
                projectSlug: 'test-project',
                json: true,
            });

            const ws = await storage.readWorkingSet('test-project', result.task.task_slug);
            expect(ws).toContain('Working Set');
        });
    });

    describe('cmdTasks', () => {
        it('returns empty array when no tasks', async () => {
            const result = await localCli.cmdTasks({
                projectSlug: 'test-project',
                json: true,
            });

            expect(result.tasks).toEqual([]);
        });

        it('lists created tasks', async () => {
            await localCli.cmdNew({
                userRequest: 'Task 1',
                projectSlug: 'test-project',
                json: true,
            });
            await localCli.cmdNew({
                userRequest: 'Task 2',
                projectSlug: 'test-project',
                json: true,
            });

            const result = await localCli.cmdTasks({
                projectSlug: 'test-project',
                all: true,
                json: true,
            });

            expect(result.tasks).toHaveLength(2);
        });

        it('filters completed tasks by default', async () => {
            const { task } = await localCli.cmdNew({
                userRequest: 'Task 1',
                projectSlug: 'test-project',
                json: true,
            });

            await localCli.cmdComplete({
                taskSlug: task.task_slug,
                projectSlug: 'test-project',
                json: true,
            });

            const result = await localCli.cmdTasks({
                projectSlug: 'test-project',
                json: true,
            });

            expect(result.tasks).toHaveLength(0);
        });
    });

    describe('cmdShow', () => {
        it('shows task details', async () => {
            const { task } = await localCli.cmdNew({
                userRequest: 'Test task',
                projectSlug: 'test-project',
                json: true,
            });

            const result = await localCli.cmdShow({
                taskSlug: task.task_slug,
                projectSlug: 'test-project',
                json: true,
            });

            expect(result.task.user_request).toBe('Test task');
            expect(result.workingSet).toBeDefined();
        });

        it('throws for non-existent task', async () => {
            await expect(localCli.cmdShow({
                taskSlug: 'nonexistent',
                projectSlug: 'test-project',
                json: true,
            })).rejects.toThrow(/not found/);
        });
    });

    describe('cmdComplete', () => {
        it('marks task as done', async () => {
            const { task } = await localCli.cmdNew({
                userRequest: 'Test task',
                projectSlug: 'test-project',
                json: true,
            });

            const result = await localCli.cmdComplete({
                taskSlug: task.task_slug,
                projectSlug: 'test-project',
                json: true,
            });

            expect(result.task.status).toBe('done');
        });
    });

    describe('resolveTaskSlug', () => {
        it('resolves index notation', async () => {
            const { task } = await localCli.cmdNew({
                userRequest: 'First task',
                projectSlug: 'test-project',
                json: true,
            });

            const resolved = await localCli.resolveTaskSlug('test-project', '#1');
            expect(resolved).toBe(task.task_slug);
        });

        it('throws for invalid index', async () => {
            await expect(localCli.resolveTaskSlug('test-project', '#99'))
                .rejects.toThrow(/Invalid task index/);
        });

        it('passes through direct slugs', async () => {
            const resolved = await localCli.resolveTaskSlug('test-project', 'my-task');
            expect(resolved).toBe('my-task');
        });
    });

    describe('formatRelativeTime', () => {
        it('formats recent times as just now', () => {
            const now = new Date().toISOString();
            expect(localCli.formatRelativeTime(now)).toBe('just now');
        });

        it('formats minutes ago', () => {
            const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            expect(localCli.formatRelativeTime(fiveMinAgo)).toBe('5m ago');
        });

        it('formats hours ago', () => {
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
            expect(localCli.formatRelativeTime(twoHoursAgo)).toBe('2h ago');
        });

        it('formats days ago', () => {
            const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
            expect(localCli.formatRelativeTime(threeDaysAgo)).toBe('3d ago');
        });

        it('handles null/undefined', () => {
            expect(localCli.formatRelativeTime(null)).toBe('unknown');
            expect(localCli.formatRelativeTime(undefined)).toBe('unknown');
        });
    });
});
