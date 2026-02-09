/**
 * Tests for lib/storage/runs.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Store original env
const originalEnv = { ...process.env };

describe('lib/storage/runs', () => {
    let testDir;
    let runs;
    let state;
    let paths;
    let atomic;

    beforeEach(async () => {
        // Create temp directory for each test
        testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agx-runs-test-'));
        process.env.AGX_HOME = testDir;

        // Clear module cache to pick up new AGX_HOME
        jest.resetModules();
        runs = require('../../../lib/storage/runs');
        state = require('../../../lib/storage/state');
        paths = require('../../../lib/storage/paths');
        atomic = require('../../../lib/storage/atomic');

        // Set up project and task
        await state.writeProjectState('my-project', { repo_path: '/path' });
        await state.createTask('my-project', {
            user_request: 'Test task',
            taskSlug: 'my-task',
        });
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

    describe('createRun', () => {
        it('creates run directory structure', async () => {
            const run = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });

            expect(run.run_id).toMatch(/^\d{8}-\d{6}-[a-f0-9]{4}$/);
            expect(run.stage).toBe('execute');
            expect(run.finalized).toBe(false);

            // Check directory exists
            const dirExists = fs.existsSync(run.paths.root);
            expect(dirExists).toBe(true);

            // Check artifacts directory exists
            const artifactsExists = fs.existsSync(run.paths.artifacts);
            expect(artifactsExists).toBe(true);
        });

        it('writes meta.json stub', async () => {
            const run = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
                model: 'claude-3.5',
            });

            const meta = await atomic.readJsonSafe(run.paths.meta);
            expect(meta.run_id).toBe(run.run_id);
            expect(meta.project_slug).toBe('my-project');
            expect(meta.task_slug).toBe('my-task');
            expect(meta.stage).toBe('execute');
            expect(meta.engine).toBe('claude');
            expect(meta.model).toBe('claude-3.5');
            expect(meta.created_at).toBeDefined();
            expect(meta.sizes).toEqual({});
        });

        it('writes RUN_STARTED event', async () => {
            const run = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });

            const events = require('../../../lib/storage/events');
            const eventList = await events.readEvents(run.paths.events);

            expect(eventList).toHaveLength(1);
            expect(eventList[0].t).toBe('RUN_STARTED');
            expect(eventList[0].run_id).toBe(run.run_id);
            expect(eventList[0].stage).toBe('execute');
        });

        it('includes git metadata when provided', async () => {
            const run = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
                git: { commit: 'abc123', dirty: true },
            });

            const meta = await atomic.readJsonSafe(run.paths.meta);
            expect(meta.git.commit).toBe('abc123');
            expect(meta.git.dirty).toBe(true);
        });

        it('throws for invalid stage', async () => {
            await expect(
                runs.createRun({
                    projectSlug: 'my-project',
                    taskSlug: 'my-task',
                    stage: 'invalid',
                    engine: 'claude',
                })
            ).rejects.toThrow();
        });
    });

    describe('writePrompt', () => {
        it('writes prompt.md and updates sizes', async () => {
            const run = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });

            await runs.writePrompt(run, '# Prompt\n\nDo something.');

            const content = await fs.promises.readFile(run.paths.prompt, 'utf8');
            expect(content).toBe('# Prompt\n\nDo something.');

            const meta = await atomic.readJsonSafe(run.paths.meta);
            expect(meta.sizes.prompt_bytes).toBeGreaterThan(0);
        });

        it('throws for finalized run', async () => {
            const run = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });

            await runs.finalizeRun(run, { status: 'done', reason: 'Complete' });

            await expect(runs.writePrompt(run, 'test')).rejects.toThrow(/finalized/);
        });
    });

    describe('writeOutput', () => {
        it('writes output.md and updates sizes', async () => {
            const run = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });

            await runs.writeOutput(run, 'Model response here');

            const content = await fs.promises.readFile(run.paths.output, 'utf8');
            expect(content).toBe('Model response here');

            const meta = await atomic.readJsonSafe(run.paths.meta);
            expect(meta.sizes.output_bytes).toBeGreaterThan(0);
        });
    });

    describe('finalizeRun', () => {
        it('writes decision.json last', async () => {
            const run = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });

            await runs.writePrompt(run, 'prompt');
            await runs.writeOutput(run, 'output');

            // Decision should not exist yet
            const beforeDecision = await atomic.fileExists(run.paths.decision);
            expect(beforeDecision).toBe(false);

            await runs.finalizeRun(run, {
                status: 'continue',
                reason: 'More work needed',
                next_actions: [{ type: 'code', summary: 'Add feature' }],
            });

            // Decision should exist now
            const afterDecision = await atomic.fileExists(run.paths.decision);
            expect(afterDecision).toBe(true);

            const decision = await atomic.readJsonSafe(run.paths.decision);
            expect(decision.status).toBe('continue');
            expect(decision.reason).toBe('More work needed');
        });

        it('writes RUN_FINISHED event', async () => {
            const run = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });

            await runs.finalizeRun(run, { status: 'done' });

            const events = require('../../../lib/storage/events');
            const eventList = await events.readEvents(run.paths.events);

            const finishedEvent = eventList.find(e => e.t === 'RUN_FINISHED');
            expect(finishedEvent).toBeDefined();
            expect(finishedEvent.status).toBe('done');
        });

        it('updates last_run', async () => {
            const run = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });

            await runs.finalizeRun(run, { status: 'done' });

            const lastRun = await state.readLastRun('my-project', 'my-task');
            expect(lastRun.overall.run_id).toBe(run.run_id);
            expect(lastRun.execute.run_id).toBe(run.run_id);
        });

        it('throws if already finalized', async () => {
            const run = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });

            await runs.finalizeRun(run, { status: 'done' });

            await expect(
                runs.finalizeRun(run, { status: 'done' })
            ).rejects.toThrow(/already finalized/);
        });
    });

    describe('failRun', () => {
        it('writes RUN_FAILED event and decision', async () => {
            const run = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });

            await runs.failRun(run, { error: 'Something broke', code: 'ERR_TEST' });

            const decision = await atomic.readJsonSafe(run.paths.decision);
            expect(decision.status).toBe('failed');
            expect(decision.reason).toBe('Something broke');
            expect(decision.error_code).toBe('ERR_TEST');

            const events = require('../../../lib/storage/events');
            const eventList = await events.readEvents(run.paths.events);

            const failedEvent = eventList.find(e => e.t === 'RUN_FAILED');
            expect(failedEvent).toBeDefined();
            expect(failedEvent.error).toBe('Something broke');
        });
    });

    describe('writeArtifact', () => {
        it('writes artifact file to artifacts directory', async () => {
            const run = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });

            await runs.writeArtifact(run, 'logs.txt', 'Some log content');
            await runs.writeArtifact(run, 'files/output.json', '{"data": true}');

            const logs = await fs.promises.readFile(path.join(run.paths.artifacts, 'logs.txt'), 'utf8');
            expect(logs).toBe('Some log content');

            const output = await fs.promises.readFile(path.join(run.paths.artifacts, 'files/output.json'), 'utf8');
            expect(output).toBe('{"data": true}');
        });
    });

    describe('listRuns', () => {
        it('returns empty array for no runs', async () => {
            const result = await runs.listRuns('my-project', 'my-task');
            expect(result).toEqual([]);
        });

        it('lists all runs sorted by run_id', async () => {
            const run1 = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });
            await runs.finalizeRun(run1, { status: 'continue' });

            const run2 = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });
            await runs.finalizeRun(run2, { status: 'done' });

            const result = await runs.listRuns('my-project', 'my-task');
            expect(result).toHaveLength(2);

            // Both runs should be present (order may vary within same second due to random suffix)
            const runIds = result.map(r => r.run_id);
            expect(runIds).toContain(run1.run_id);
            expect(runIds).toContain(run2.run_id);

            // Results should be sorted (ascending by run_id string)
            expect(result[0].run_id.localeCompare(result[1].run_id)).toBeLessThan(0);
        });

        it('filters by stage', async () => {
            const planRun = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'plan',
                engine: 'claude',
            });
            await runs.finalizeRun(planRun, { status: 'continue' });

            const executeRun = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });
            await runs.finalizeRun(executeRun, { status: 'done' });

            const planRuns = await runs.listRuns('my-project', 'my-task', { stage: 'plan' });
            expect(planRuns).toHaveLength(1);
            expect(planRuns[0].stage).toBe('plan');

            const executeRuns = await runs.listRuns('my-project', 'my-task', { stage: 'execute' });
            expect(executeRuns).toHaveLength(1);
            expect(executeRuns[0].stage).toBe('execute');
        });

        it('includes hasDecision flag', async () => {
            const run = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });

            let result = await runs.listRuns('my-project', 'my-task');
            expect(result[0].hasDecision).toBe(false);

            await runs.finalizeRun(run, { status: 'done' });

            result = await runs.listRuns('my-project', 'my-task');
            expect(result[0].hasDecision).toBe(true);
        });
    });

    describe('findIncompleteRuns', () => {
        it('returns runs without decision.json', async () => {
            const run1 = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });
            await runs.finalizeRun(run1, { status: 'done' });

            const run2 = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });
            // Don't finalize run2

            const incomplete = await runs.findIncompleteRuns('my-project', 'my-task');
            expect(incomplete).toHaveLength(1);
            expect(incomplete[0].run_id).toBe(run2.run_id);
        });
    });

    describe('createRecoveryRun', () => {
        it('creates resume run with RECOVERY_DETECTED event', async () => {
            const run1 = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });
            // Don't finalize - simulating crash

            const incomplete = await runs.findIncompleteRuns('my-project', 'my-task');
            const recoveryRun = await runs.createRecoveryRun('my-project', 'my-task', incomplete[0]);

            expect(recoveryRun.stage).toBe('resume');

            const events = require('../../../lib/storage/events');
            const eventList = await events.readEvents(recoveryRun.paths.events);

            const recoveryEvent = eventList.find(e => e.t === 'RECOVERY_DETECTED');
            expect(recoveryEvent).toBeDefined();
            expect(recoveryEvent.incomplete_run_id).toBe(run1.run_id);
        });
    });

    describe('readDecision', () => {
        it('returns decision for completed run', async () => {
            const run = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });
            await runs.finalizeRun(run, { status: 'continue', reason: 'Test reason' });

            const decision = await runs.readDecision('my-project', 'my-task', 'execute', run.run_id);
            expect(decision.status).toBe('continue');
            expect(decision.reason).toBe('Test reason');
        });

        it('returns null for incomplete run', async () => {
            const run = await runs.createRun({
                projectSlug: 'my-project',
                taskSlug: 'my-task',
                stage: 'execute',
                engine: 'claude',
            });

            const decision = await runs.readDecision('my-project', 'my-task', 'execute', run.run_id);
            expect(decision).toBeNull();
        });
    });

    describe('gcRuns', () => {
        afterEach(() => {
            // Ensure we don't leak fake timers into other test suites.
            jest.useRealTimers();
        });

        it('keeps newest N runs and deletes the rest (deterministic ordering by second)', async () => {
            jest.useFakeTimers();

            const created = [];
            const base = new Date('2026-02-08T00:00:00.000Z');

            for (let i = 0; i < 30; i++) {
                jest.setSystemTime(new Date(base.getTime() + i * 1000));
                const run = await runs.createRun({
                    projectSlug: 'my-project',
                    taskSlug: 'my-task',
                    stage: 'execute',
                    engine: 'claude',
                });
                await runs.finalizeRun(run, { status: 'done' });
                created.push(run.run_id);
            }

            const result = await runs.gcRuns('my-project', 'my-task', { keep: 25 });
            expect(result.deleted).toBe(5);

            const remaining = await runs.listRuns('my-project', 'my-task', { stage: 'execute' });
            expect(remaining).toHaveLength(25);
            expect(remaining.map(r => r.run_id)).toEqual(created.slice(5));
        });

        it('preserves all runs when task is blocked/failed (default policy)', async () => {
            jest.useFakeTimers();

            // Mark task as blocked
            await state.updateTaskState('my-project', 'my-task', { status: 'blocked' });

            const base = new Date('2026-02-08T00:10:00.000Z');
            for (let i = 0; i < 3; i++) {
                jest.setSystemTime(new Date(base.getTime() + i * 1000));
                const run = await runs.createRun({
                    projectSlug: 'my-project',
                    taskSlug: 'my-task',
                    stage: 'execute',
                    engine: 'claude',
                });
                await runs.finalizeRun(run, { status: 'done' });
            }

            const result = await runs.gcRuns('my-project', 'my-task', { keep: 1 });
            expect(result.deleted).toBe(0);

            const remaining = await runs.listRuns('my-project', 'my-task', { stage: 'execute' });
            expect(remaining).toHaveLength(3);
        });
    });
});
