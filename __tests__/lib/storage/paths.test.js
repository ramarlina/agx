/**
 * Tests for lib/storage/paths.js
 */

const path = require('path');
const os = require('os');

// Store original env
const originalEnv = { ...process.env };

// Import module under test
const paths = require('../../../lib/storage/paths');

describe('lib/storage/paths', () => {
    beforeEach(() => {
        // Reset env
        delete process.env.AGX_HOME;
    });

    afterEach(() => {
        // Restore env
        process.env = { ...originalEnv };
    });

    describe('getAgxHome', () => {
        it('respects AGX_HOME environment variable', () => {
            process.env.AGX_HOME = '/custom/agx/home';
            expect(paths.getAgxHome()).toBe('/custom/agx/home');
        });

        it('falls back to ~/.agx', () => {
            delete process.env.AGX_HOME;
            expect(paths.getAgxHome()).toBe(path.join(os.homedir(), '.agx'));
        });
    });

    describe('validateSlug', () => {
        it('accepts valid kebab-case slugs', () => {
            expect(paths.validateSlug('my-task').valid).toBe(true);
            expect(paths.validateSlug('task123').valid).toBe(true);
            expect(paths.validateSlug('a').valid).toBe(true);
            expect(paths.validateSlug('a-b-c').valid).toBe(true);
            expect(paths.validateSlug('daemon-worker-pool').valid).toBe(true);
        });

        it('rejects uppercase', () => {
            expect(paths.validateSlug('MyTask').valid).toBe(false);
            expect(paths.validateSlug('my-Task').valid).toBe(false);
        });

        it('rejects spaces', () => {
            expect(paths.validateSlug('my task').valid).toBe(false);
            expect(paths.validateSlug(' my-task').valid).toBe(false);
        });

        it('rejects path separators', () => {
            expect(paths.validateSlug('my/task').valid).toBe(false);
            expect(paths.validateSlug('my\\task').valid).toBe(false);
        });

        it('rejects empty string', () => {
            expect(paths.validateSlug('').valid).toBe(false);
            expect(paths.validateSlug(null).valid).toBe(false);
            expect(paths.validateSlug(undefined).valid).toBe(false);
        });

        it('rejects leading/trailing hyphens', () => {
            expect(paths.validateSlug('-my-task').valid).toBe(false);
            expect(paths.validateSlug('my-task-').valid).toBe(false);
            expect(paths.validateSlug('-').valid).toBe(false);
        });

        it('rejects consecutive hyphens', () => {
            expect(paths.validateSlug('my--task').valid).toBe(false);
        });

        it('rejects path traversal attempts', () => {
            expect(paths.validateSlug('..').valid).toBe(false);
            expect(paths.validateSlug('my..task').valid).toBe(false);
        });

        it('rejects slugs over 128 characters', () => {
            const longSlug = 'a'.repeat(129);
            expect(paths.validateSlug(longSlug).valid).toBe(false);
        });
    });

    describe('slugify', () => {
        it('produces stable output for same input', () => {
            const input = 'My Test Task';
            expect(paths.slugify(input)).toBe(paths.slugify(input));
        });

        it('converts to lowercase', () => {
            expect(paths.slugify('MY TASK')).toBe('my-task');
        });

        it('replaces spaces with hyphens', () => {
            expect(paths.slugify('my test task')).toBe('my-test-task');
        });

        it('replaces underscores with hyphens', () => {
            expect(paths.slugify('my_test_task')).toBe('my-test-task');
        });

        it('removes special characters', () => {
            expect(paths.slugify('my@task!')).toBe('mytask');
            expect(paths.slugify('test (task) #1')).toBe('test-task-1');
        });

        it('collapses consecutive hyphens', () => {
            expect(paths.slugify('my  test   task')).toBe('my-test-task');
            expect(paths.slugify('my--task')).toBe('my-task');
        });

        it('removes leading/trailing hyphens', () => {
            expect(paths.slugify(' my task ')).toBe('my-task');
            expect(paths.slugify('--my-task--')).toBe('my-task');
        });

        it('returns "untitled" for empty/null input', () => {
            expect(paths.slugify('')).toBe('untitled');
            expect(paths.slugify(null)).toBe('untitled');
            expect(paths.slugify(undefined)).toBe('untitled');
        });

        it('truncates to max length', () => {
            const longInput = 'a'.repeat(100);
            expect(paths.slugify(longInput, { maxLength: 20 }).length).toBeLessThanOrEqual(20);
        });

        it('does not end with hyphen after truncation', () => {
            const result = paths.slugify('word word word word', { maxLength: 10 });
            expect(result.endsWith('-')).toBe(false);
        });
    });

    describe('generateRunId', () => {
        it('generates sortable IDs', () => {
            const id1 = paths.generateRunId();
            const id2 = paths.generateRunId();

            // IDs should follow YYYYMMDD-HHMMSS-<hex4|hex8> format (which is sortable by date/time)
            expect(id1).toMatch(/^\d{8}-\d{6}-[a-f0-9]{4}(?:[a-f0-9]{4})?$/);
            expect(id2).toMatch(/^\d{8}-\d{6}-[a-f0-9]{4}(?:[a-f0-9]{4})?$/);

            // The date-time portion should be identical or later
            const dt1 = id1.slice(0, 15); // YYYYMMDD-HHMMSS
            const dt2 = id2.slice(0, 15);
            expect(dt2 >= dt1).toBe(true);
        });

        it('never returns the same ID', () => {
            const ids = new Set();
            for (let i = 0; i < 100; i++) {
                ids.add(paths.generateRunId());
            }
            expect(ids.size).toBe(100);
        });

        it('follows YYYYMMDD-HHMMSS-<hex4|hex8> format', () => {
            const id = paths.generateRunId();
            expect(id).toMatch(/^\d{8}-\d{6}-[a-f0-9]{4}(?:[a-f0-9]{4})?$/);
        });
    });

    describe('validateRunId', () => {
        it('accepts valid run IDs', () => {
            expect(paths.validateRunId('20260208-141233-a9f3').valid).toBe(true);
            expect(paths.validateRunId(paths.generateRunId()).valid).toBe(true);
        });

        it('rejects invalid run IDs', () => {
            expect(paths.validateRunId('invalid').valid).toBe(false);
            expect(paths.validateRunId('2026-02-08').valid).toBe(false);
            expect(paths.validateRunId('').valid).toBe(false);
            expect(paths.validateRunId(null).valid).toBe(false);
        });
    });

    describe('validateStage', () => {
        it('accepts valid stages', () => {
            expect(paths.validateStage('plan').valid).toBe(true);
            expect(paths.validateStage('execute').valid).toBe(true);
            expect(paths.validateStage('verify').valid).toBe(true);
            expect(paths.validateStage('resume').valid).toBe(true);
        });

        it('rejects invalid stages', () => {
            expect(paths.validateStage('invalid').valid).toBe(false);
            expect(paths.validateStage('PLAN').valid).toBe(false);
            expect(paths.validateStage('').valid).toBe(false);
        });
    });

    describe('path construction', () => {
        beforeEach(() => {
            process.env.AGX_HOME = '/test/agx';
        });

        it('projectsRoot returns correct path', () => {
            expect(paths.projectsRoot()).toBe('/test/agx/projects');
        });

        it('projectRoot returns correct path', () => {
            expect(paths.projectRoot('my-project')).toBe('/test/agx/projects/my-project');
        });

        it('projectRoot throws for invalid slug', () => {
            expect(() => paths.projectRoot('INVALID')).toThrow();
            expect(() => paths.projectRoot('../escape')).toThrow();
        });

        it('taskRoot returns correct path', () => {
            expect(paths.taskRoot('my-project', 'my-task')).toBe('/test/agx/projects/my-project/my-task');
        });

        it('taskRoot throws for invalid slugs', () => {
            expect(() => paths.taskRoot('INVALID', 'my-task')).toThrow();
            expect(() => paths.taskRoot('my-project', 'INVALID')).toThrow();
        });

        it('runRoot returns correct path', () => {
            const runId = '20260208-141233-a9f3';
            expect(paths.runRoot('my-project', 'my-task', 'execute', runId))
                .toBe('/test/agx/projects/my-project/my-task/20260208-141233-a9f3/execute');
        });

        it('runRoot throws for invalid stage', () => {
            expect(() => paths.runRoot('my-project', 'my-task', 'invalid', '20260208-141233-a9f3')).toThrow();
        });

        it('runRoot throws for invalid run ID', () => {
            expect(() => paths.runRoot('my-project', 'my-task', 'execute', 'invalid')).toThrow();
        });

        it('runPaths returns all expected paths', () => {
            const runId = '20260208-141233-a9f3';
            const p = paths.runPaths('my-project', 'my-task', 'execute', runId);

            expect(p.root).toContain('20260208-141233-a9f3/execute');
            expect(p.meta).toContain('meta.json');
            expect(p.prompt).toContain('prompt.md');
            expect(p.output).toContain('output.md');
            expect(p.decision).toContain('decision.json');
            expect(p.events).toContain('events.ndjson');
            expect(p.plan).toContain(`${path.sep}plan`);
            expect(p.artifacts).toContain('artifacts');
        });

        it('graphJsonPath returns graph.json under task root', () => {
            expect(paths.graphJsonPath('my-project', 'my-task'))
                .toBe('/test/agx/projects/my-project/my-task/graph.json');
        });

        it('never escapes AGX_HOME even with malicious slugs', () => {
            // These should throw before returning paths
            expect(() => paths.projectRoot('../escape')).toThrow();
            expect(() => paths.taskRoot('project', '../escape')).toThrow();

            // Valid slugs stay within bounds
            const validPath = paths.projectRoot('safe-project');
            expect(validPath.startsWith('/test/agx/projects/')).toBe(true);
        });
    });
});
