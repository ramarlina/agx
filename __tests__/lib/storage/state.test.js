/**
 * Tests for lib/storage/state.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Store original env
const originalEnv = { ...process.env };

describe('lib/storage/state', () => {
    let testDir;
    let state;
    let paths;

    beforeEach(async () => {
        // Create temp directory for each test
        testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agx-state-test-'));
        process.env.AGX_HOME = testDir;

        // Clear module cache to pick up new AGX_HOME
        jest.resetModules();
        state = require('../../../lib/storage/state');
        paths = require('../../../lib/storage/paths');
    });

    afterEach(async () => {
        // Clean up
        try {
            await fs.promises.rm(testDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
        process.env = { ...originalEnv };
    });

    describe('project state', () => {
        it('writeProjectState creates project.json', async () => {
            await state.writeProjectState('my-project', {
                repo_path: '/path/to/repo',
                default_engine: 'claude',
            });

            const filePath = paths.projectJsonPath('my-project');
            const exists = fs.existsSync(filePath);
            expect(exists).toBe(true);
        });

        it('readProjectState returns null for non-existent project', async () => {
            const result = await state.readProjectState('nonexistent');
            expect(result).toBeNull();
        });

        it('readProjectState returns project data', async () => {
            await state.writeProjectState('my-project', {
                repo_path: '/path/to/repo',
            });

            const result = await state.readProjectState('my-project');
            expect(result.project_slug).toBe('my-project');
            expect(result.repo_path).toBe('/path/to/repo');
        });

        it('writeProjectState merges with existing data', async () => {
            await state.writeProjectState('my-project', { repo_path: '/old/path' });
            await state.writeProjectState('my-project', { default_engine: 'gemini' });

            const result = await state.readProjectState('my-project');
            expect(result.repo_path).toBe('/old/path');
            expect(result.default_engine).toBe('gemini');
        });

        it('project_slug cannot be changed via update', async () => {
            await state.writeProjectState('my-project', {});
            await state.writeProjectState('my-project', { project_slug: 'changed' });

            const result = await state.readProjectState('my-project');
            expect(result.project_slug).toBe('my-project');
        });
    });

    describe('project index', () => {
        it('readProjectIndex returns empty tasks for new project', async () => {
            const result = await state.readProjectIndex('my-project');
            expect(result.project_slug).toBe('my-project');
            expect(result.tasks).toEqual([]);
        });

        it('updateProjectIndexEntry adds new task', async () => {
            await state.updateProjectIndexEntry('my-project', 'task-1', { status: 'running' });

            const result = await state.readProjectIndex('my-project');
            expect(result.tasks).toHaveLength(1);
            expect(result.tasks[0].task_slug).toBe('task-1');
            expect(result.tasks[0].status).toBe('running');
        });

        it('updateProjectIndexEntry updates existing task', async () => {
            await state.updateProjectIndexEntry('my-project', 'task-1', { status: 'pending' });
            await state.updateProjectIndexEntry('my-project', 'task-1', { status: 'done' });

            const result = await state.readProjectIndex('my-project');
            expect(result.tasks).toHaveLength(1);
            expect(result.tasks[0].status).toBe('done');
        });

        it('removeProjectIndexEntry removes task', async () => {
            await state.updateProjectIndexEntry('my-project', 'task-1', { status: 'pending' });
            await state.updateProjectIndexEntry('my-project', 'task-2', { status: 'running' });
            await state.removeProjectIndexEntry('my-project', 'task-1');

            const result = await state.readProjectIndex('my-project');
            expect(result.tasks).toHaveLength(1);
            expect(result.tasks[0].task_slug).toBe('task-2');
        });
    });

    describe('task state', () => {
        beforeEach(async () => {
            // Create project first
            await state.writeProjectState('my-project', { repo_path: '/path' });
        });

        it('createTask creates task.json and related files', async () => {
            const task = await state.createTask('my-project', {
                user_request: 'Build a feature',
                goal: 'Implement the feature',
                criteria: ['Works correctly', 'Has tests'],
            });

            expect(task.task_slug).toBeDefined();
            expect(task.user_request).toBe('Build a feature');
            expect(task.goal).toBe('Implement the feature');
            expect(task.criteria).toEqual(['Works correctly', 'Has tests']);
            expect(task.status).toBe('pending');

            // Check files were created
            const taskJson = await state.readTaskState('my-project', task.task_slug);
            expect(taskJson).not.toBeNull();

            const workingSet = await state.readWorkingSet('my-project', task.task_slug);
            expect(workingSet).toBe('');

            const approvals = await state.readApprovals('my-project', task.task_slug);
            expect(approvals.pending).toEqual([]);
        });

        it('createTask uses user_request as goal if not provided', async () => {
            const task = await state.createTask('my-project', {
                user_request: 'Do something',
            });

            expect(task.goal).toBe('Do something');
        });

        it('createTask allows custom taskSlug', async () => {
            const task = await state.createTask('my-project', {
                user_request: 'Test',
                taskSlug: 'custom-slug',
            });

            expect(task.task_slug).toBe('custom-slug');
        });

        it('createTask throws for duplicate task', async () => {
            await state.createTask('my-project', {
                user_request: 'First',
                taskSlug: 'my-task',
            });

            await expect(
                state.createTask('my-project', {
                    user_request: 'Second',
                    taskSlug: 'my-task',
                })
            ).rejects.toThrow(/already exists/);
        });

        it('readTaskState returns null for non-existent task', async () => {
            const result = await state.readTaskState('my-project', 'nonexistent');
            expect(result).toBeNull();
        });

        it('updateTaskState updates allowed fields', async () => {
            await state.createTask('my-project', {
                user_request: 'Original',
                taskSlug: 'my-task',
            });

            await state.updateTaskState('my-project', 'my-task', {
                goal: 'Updated goal',
                status: 'running',
            });

            const result = await state.readTaskState('my-project', 'my-task');
            expect(result.goal).toBe('Updated goal');
            expect(result.status).toBe('running');
        });

        it('updateTaskState preserves immutable fields', async () => {
            await state.createTask('my-project', {
                user_request: 'Original request',
                taskSlug: 'my-task',
            });

            await state.updateTaskState('my-project', 'my-task', {
                user_request: 'Changed request',
                task_slug: 'changed-slug',
            });

            const result = await state.readTaskState('my-project', 'my-task');
            expect(result.user_request).toBe('Original request');
            expect(result.task_slug).toBe('my-task');
        });

        it('updateTaskState throws for non-existent task', async () => {
            await expect(
                state.updateTaskState('my-project', 'nonexistent', { status: 'done' })
            ).rejects.toThrow(/not found/);
        });

        it('updateTaskState updates project index', async () => {
            await state.createTask('my-project', {
                user_request: 'Test',
                taskSlug: 'my-task',
            });

            await state.updateTaskState('my-project', 'my-task', { status: 'done' });

            const index = await state.readProjectIndex('my-project');
            const entry = index.tasks.find(t => t.task_slug === 'my-task');
            expect(entry.status).toBe('done');
        });
    });

    describe('working set', () => {
        beforeEach(async () => {
            await state.writeProjectState('my-project', { repo_path: '/path' });
            await state.createTask('my-project', {
                user_request: 'Test',
                taskSlug: 'my-task',
            });
        });

        it('readWorkingSet returns empty string for new task', async () => {
            const result = await state.readWorkingSet('my-project', 'my-task');
            expect(result).toBe('');
        });

        it('writeWorkingSet stores content under cap', async () => {
            const result = await state.writeWorkingSet('my-project', 'my-task', 'Some content');

            expect(result.written).toBe('Some content');
            expect(result.rewritten).toBe(false);

            const read = await state.readWorkingSet('my-project', 'my-task');
            expect(read).toBe('Some content');
        });

        it('writeWorkingSet truncates content over cap', async () => {
            const longContent = 'x'.repeat(5000);
            const result = await state.writeWorkingSet('my-project', 'my-task', longContent, { maxChars: 100 });

            expect(result.rewritten).toBe(true);
            expect(result.written.length).toBeLessThanOrEqual(100);
            expect(result.originalBytes).toBeGreaterThan(result.newBytes);
        });

        it('writeWorkingSet uses custom summarizer', async () => {
            const longContent = 'x'.repeat(5000);
            const summarizer = (content, max) => 'SUMMARIZED';

            const result = await state.writeWorkingSet('my-project', 'my-task', longContent, {
                maxChars: 100,
                summarizer,
            });

            expect(result.written).toBe('SUMMARIZED');
            expect(result.rewritten).toBe(true);
        });
    });

    describe('approvals', () => {
        beforeEach(async () => {
            await state.writeProjectState('my-project', { repo_path: '/path' });
            await state.createTask('my-project', {
                user_request: 'Test',
                taskSlug: 'my-task',
            });
        });

        it('addPendingApproval adds to pending list', async () => {
            const request = await state.addPendingApproval('my-project', 'my-task', {
                action: 'git push',
                reason: 'publishes changes',
            });

            expect(request.id).toMatch(/^appr_/);
            expect(request.action).toBe('git push');

            const approvals = await state.readApprovals('my-project', 'my-task');
            expect(approvals.pending).toHaveLength(1);
        });

        it('approveRequest moves from pending to approved', async () => {
            const request = await state.addPendingApproval('my-project', 'my-task', {
                action: 'deploy',
                reason: 'production deploy',
            });

            await state.approveRequest('my-project', 'my-task', request.id);

            const approvals = await state.readApprovals('my-project', 'my-task');
            expect(approvals.pending).toHaveLength(0);
            expect(approvals.approved).toHaveLength(1);
            expect(approvals.approved[0].id).toBe(request.id);
        });

        it('rejectRequest moves from pending to rejected', async () => {
            const request = await state.addPendingApproval('my-project', 'my-task', {
                action: 'deploy',
                reason: 'production deploy',
            });

            await state.rejectRequest('my-project', 'my-task', request.id);

            const approvals = await state.readApprovals('my-project', 'my-task');
            expect(approvals.pending).toHaveLength(0);
            expect(approvals.rejected).toHaveLength(1);
        });

        it('approveRequest returns null for unknown ID', async () => {
            const result = await state.approveRequest('my-project', 'my-task', 'unknown');
            expect(result).toBeNull();
        });
    });

    describe('last run', () => {
        beforeEach(async () => {
            await state.writeProjectState('my-project', { repo_path: '/path' });
            await state.createTask('my-project', {
                user_request: 'Test',
                taskSlug: 'my-task',
            });
        });

        it('readLastRun returns empty object for new task', async () => {
            const result = await state.readLastRun('my-project', 'my-task');
            expect(result).toEqual({});
        });

        it('updateLastRun sets stage and overall', async () => {
            await state.updateLastRun('my-project', 'my-task', 'execute', 'run-123');

            const result = await state.readLastRun('my-project', 'my-task');
            expect(result.overall).toEqual({ stage: 'execute', run_id: 'run-123' });
            expect(result.execute).toEqual({ run_id: 'run-123' });
        });

        it('updateLastRun tracks multiple stages', async () => {
            await state.updateLastRun('my-project', 'my-task', 'plan', 'run-1');
            await state.updateLastRun('my-project', 'my-task', 'execute', 'run-2');

            const result = await state.readLastRun('my-project', 'my-task');
            expect(result.overall).toEqual({ stage: 'execute', run_id: 'run-2' });
            expect(result.plan).toEqual({ run_id: 'run-1' });
            expect(result.execute).toEqual({ run_id: 'run-2' });
        });
    });
});
