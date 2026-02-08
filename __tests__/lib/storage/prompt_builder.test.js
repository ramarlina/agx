/**
 * Tests for lib/storage/prompt_builder.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Store original env
const originalEnv = { ...process.env };

describe('lib/storage/prompt_builder', () => {
    let testDir;
    let promptBuilder;
    let state;
    let runs;

    beforeEach(async () => {
        // Create temp directory for each test
        testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agx-prompt-test-'));
        process.env.AGX_HOME = testDir;

        // Clear module cache to pick up new AGX_HOME
        jest.resetModules();
        promptBuilder = require('../../../lib/storage/prompt_builder');
        state = require('../../../lib/storage/state');
        runs = require('../../../lib/storage/runs');

        // Set up project and task
        await state.writeProjectState('my-project', { repo_path: '/path/to/repo' });
        await state.createTask('my-project', {
            user_request: 'Build a REST API',
            goal: 'Create a REST API with authentication',
            criteria: ['All endpoints documented', 'Tests pass'],
            taskSlug: 'build-rest-api',
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

    describe('buildPrompt', () => {
        it('builds prompt with task essentials', async () => {
            const result = await promptBuilder.buildPrompt({
                projectSlug: 'my-project',
                taskSlug: 'build-rest-api',
            });

            expect(result.promptText).toContain('Build a REST API');
            expect(result.promptText).toContain('Create a REST API with authentication');
            expect(result.totalBytes).toBeGreaterThan(0);
        });

        it('includes working set content', async () => {
            await state.writeWorkingSet('my-project', 'build-rest-api', '## Plan\n- Step 1\n- Step 2');

            const result = await promptBuilder.buildPrompt({
                projectSlug: 'my-project',
                taskSlug: 'build-rest-api',
            });

            expect(result.promptText).toContain('## Plan');
            expect(result.promptText).toContain('Step 1');
        });

        it('includes custom rules', async () => {
            const result = await promptBuilder.buildPrompt({
                projectSlug: 'my-project',
                taskSlug: 'build-rest-api',
                rules: 'Always use TypeScript',
            });

            expect(result.promptText).toContain('Always use TypeScript');
        });

        it('includes pending approvals', async () => {
            await state.addPendingApproval('my-project', 'build-rest-api', {
                action: 'git push',
                reason: 'Publish changes',
            });

            const result = await promptBuilder.buildPrompt({
                projectSlug: 'my-project',
                taskSlug: 'build-rest-api',
            });

            expect(result.promptText).toContain('git push');
            expect(result.promptText).toContain('Publish changes');
        });

        it('respects section budgets', async () => {
            // Write a very long working set
            const longContent = 'x'.repeat(10000);
            await state.writeWorkingSet('my-project', 'build-rest-api', longContent, { maxChars: 10000 });

            const result = await promptBuilder.buildPrompt({
                projectSlug: 'my-project',
                taskSlug: 'build-rest-api',
                budgets: {
                    working_set: 500,
                },
            });

            // Working set should be truncated
            expect(result.sizes.working_set).toBeLessThanOrEqual(550); // Some overhead
        });

        it('includes repo context when provided', async () => {
            const result = await promptBuilder.buildPrompt({
                projectSlug: 'my-project',
                taskSlug: 'build-rest-api',
                repoContext: 'This is a Node.js project',
            });

            expect(result.promptText).toContain('Node.js project');
        });

        it('tracks sizes for all sections', async () => {
            await state.writeWorkingSet('my-project', 'build-rest-api', 'Test working set');

            const result = await promptBuilder.buildPrompt({
                projectSlug: 'my-project',
                taskSlug: 'build-rest-api',
                rules: 'Test rules',
            });

            expect(result.sizes.rules).toBeGreaterThan(0);
            expect(result.sizes.task_essentials).toBeGreaterThan(0);
            expect(result.sizes.working_set).toBeGreaterThan(0);
            expect(result.totalBytes).toBeGreaterThan(0);
        });
    });

    describe('buildTaskEssentials', () => {
        it('formats task essentials with goal and criteria', async () => {
            const task = await state.readTaskState('my-project', 'build-rest-api');
            const result = promptBuilder.buildTaskEssentials(task);

            expect(result).toContain('Create a REST API with authentication');
            expect(result).toContain('All endpoints documented');
            expect(result).toContain('Tests pass');
        });

        it('handles missing criteria', async () => {
            const task = { goal: 'Do something', criteria: [] };
            const result = promptBuilder.buildTaskEssentials(task);

            expect(result).toContain('Do something');
            expect(result).not.toContain('Criteria');
        });
    });

    describe('buildApprovalsSummary', () => {
        it('returns empty string when no pending approvals', async () => {
            const approvals = await state.readApprovals('my-project', 'build-rest-api');
            const result = promptBuilder.buildApprovalsSummary(approvals);

            expect(result).toBe('');
        });

        it('formats pending approvals', async () => {
            await state.addPendingApproval('my-project', 'build-rest-api', {
                action: 'deploy to prod',
                reason: 'Release new features',
            });

            const approvals = await state.readApprovals('my-project', 'build-rest-api');
            const result = promptBuilder.buildApprovalsSummary(approvals);

            expect(result).toContain('deploy to prod');
            expect(result).toContain('Release new features');
        });
    });

    describe('buildDecisionSummary', () => {
        it('formats decision with status and reason', () => {
            const decision = {
                status: 'continue',
                reason: 'More work needed',
                next_actions: [
                    { type: 'code', summary: 'Implement auth' },
                ],
            };

            const result = promptBuilder.buildDecisionSummary(decision);

            expect(result).toContain('continue');
            expect(result).toContain('More work needed');
            expect(result).toContain('Implement auth');
        });

        it('returns empty for null decision', () => {
            const result = promptBuilder.buildDecisionSummary(null);
            expect(result).toBe('');
        });
    });

    describe('estimateTokens', () => {
        it('estimates tokens from character count', () => {
            const text = 'Hello world, this is a test prompt.';
            const estimate = promptBuilder.estimateTokens(text);

            // Rough estimate: ~4 chars per token
            expect(estimate).toBeGreaterThan(5);
            expect(estimate).toBeLessThan(20);
        });

        it('returns 0 for empty text', () => {
            expect(promptBuilder.estimateTokens('')).toBe(0);
            expect(promptBuilder.estimateTokens(null)).toBe(0);
        });
    });
});
