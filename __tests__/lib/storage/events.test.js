/**
 * Tests for lib/storage/events.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const events = require('../../../lib/storage/events');

describe('lib/storage/events', () => {
    let testDir;

    beforeEach(async () => {
        testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agx-events-test-'));
    });

    afterEach(async () => {
        try {
            await fs.promises.rm(testDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('appendEvent', () => {
        it('appends exactly one JSON object per line', async () => {
            const eventsPath = path.join(testDir, 'events.ndjson');

            await events.appendEvent(eventsPath, { t: 'TEST1', data: 'foo' });
            await events.appendEvent(eventsPath, { t: 'TEST2', data: 'bar' });

            const content = await fs.promises.readFile(eventsPath, 'utf8');
            const lines = content.trim().split('\n');

            expect(lines).toHaveLength(2);
            expect(JSON.parse(lines[0]).t).toBe('TEST1');
            expect(JSON.parse(lines[1]).t).toBe('TEST2');
        });

        it('preserves prior content', async () => {
            const eventsPath = path.join(testDir, 'events.ndjson');
            await fs.promises.writeFile(eventsPath, '{"t":"EXISTING"}\n');

            await events.appendEvent(eventsPath, { t: 'NEW' });

            const content = await fs.promises.readFile(eventsPath, 'utf8');
            const lines = content.trim().split('\n');

            expect(lines).toHaveLength(2);
            expect(JSON.parse(lines[0]).t).toBe('EXISTING');
            expect(JSON.parse(lines[1]).t).toBe('NEW');
        });

        it('writes valid JSON for each line', async () => {
            const eventsPath = path.join(testDir, 'events.ndjson');

            await events.appendEvent(eventsPath, { t: 'TEST', nested: { a: [1, 2, 3] } });

            const content = await fs.promises.readFile(eventsPath, 'utf8');
            const lines = content.trim().split('\n');

            for (const line of lines) {
                expect(() => JSON.parse(line)).not.toThrow();
            }
        });

        it('adds timestamp if not provided', async () => {
            const eventsPath = path.join(testDir, 'events.ndjson');

            await events.appendEvent(eventsPath, { t: 'TEST' });

            const content = await fs.promises.readFile(eventsPath, 'utf8');
            const event = JSON.parse(content.trim());

            expect(event).toHaveProperty('at');
            expect(new Date(event.at).getTime()).not.toBeNaN();
        });

        it('preserves provided timestamp', async () => {
            const eventsPath = path.join(testDir, 'events.ndjson');
            const customTime = '2026-01-01T00:00:00Z';

            await events.appendEvent(eventsPath, { t: 'TEST', at: customTime });

            const content = await fs.promises.readFile(eventsPath, 'utf8');
            const event = JSON.parse(content.trim());

            expect(event.at).toBe(customTime);
        });

        it('throws for non-object event', async () => {
            const eventsPath = path.join(testDir, 'events.ndjson');

            await expect(events.appendEvent(eventsPath, 'not an object')).rejects.toThrow();
            await expect(events.appendEvent(eventsPath, null)).rejects.toThrow();
        });
    });

    describe('readEvents', () => {
        it('returns array of parsed events', async () => {
            const eventsPath = path.join(testDir, 'events.ndjson');
            await fs.promises.writeFile(eventsPath, '{"t":"A"}\n{"t":"B"}\n{"t":"C"}\n');

            const result = await events.readEvents(eventsPath);

            expect(result).toHaveLength(3);
            expect(result[0].t).toBe('A');
            expect(result[1].t).toBe('B');
            expect(result[2].t).toBe('C');
        });

        it('returns empty array for non-existent file', async () => {
            const eventsPath = path.join(testDir, 'nonexistent.ndjson');

            const result = await events.readEvents(eventsPath);

            expect(result).toEqual([]);
        });

        it('skips invalid JSON lines with warning', async () => {
            const eventsPath = path.join(testDir, 'events.ndjson');
            await fs.promises.writeFile(eventsPath, '{"t":"A"}\nnot json\n{"t":"B"}\n');

            const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

            const result = await events.readEvents(eventsPath);

            expect(result).toHaveLength(2);
            expect(result[0].t).toBe('A');
            expect(result[1].t).toBe('B');
            expect(warnSpy).toHaveBeenCalled();

            warnSpy.mockRestore();
        });

        it('handles empty lines', async () => {
            const eventsPath = path.join(testDir, 'events.ndjson');
            await fs.promises.writeFile(eventsPath, '{"t":"A"}\n\n{"t":"B"}\n');

            const result = await events.readEvents(eventsPath);

            expect(result).toHaveLength(2);
        });
    });

    describe('event factories', () => {
        it('runStartedEvent creates correct structure', () => {
            const event = events.runStartedEvent({ run_id: 'test-run', stage: 'execute' });

            expect(event.t).toBe('RUN_STARTED');
            expect(event.run_id).toBe('test-run');
            expect(event.stage).toBe('execute');
        });

        it('promptBuiltEvent creates correct structure', () => {
            const event = events.promptBuiltEvent({
                sections: { working_set: 1000, task_essentials: 500 },
                total_bytes: 1500,
            });

            expect(event.t).toBe('PROMPT_BUILT');
            expect(event.sections.working_set).toBe(1000);
            expect(event.total_bytes).toBe(1500);
        });

        it('engineCallStartedEvent creates correct structure', () => {
            const event = events.engineCallStartedEvent({
                trace_id: 'trace-1',
                label: 'agx claude',
                provider: 'claude',
                model: 'test-model',
                role: 'single-iteration',
                pid: 123,
                args: ['node', 'index.js', 'claude'],
                timeout_ms: 1000,
                started_at: '2026-02-08T00:00:00Z',
            });

            expect(event.t).toBe('ENGINE_CALL_STARTED');
            expect(event.trace_id).toBe('trace-1');
            expect(event.label).toBe('agx claude');
            expect(event.provider).toBe('claude');
            expect(event.role).toBe('single-iteration');
            expect(event.pid).toBe(123);
            expect(event.timeout_ms).toBe(1000);
        });

        it('engineCallCompletedEvent creates correct structure', () => {
            const event = events.engineCallCompletedEvent({
                trace_id: 'trace-1',
                label: 'agx claude',
                provider: 'claude',
                role: 'single-iteration',
                phase: 'exit',
                exit_code: 0,
                duration_ms: 42,
                finished_at: '2026-02-08T00:00:10Z',
                stdout_tail: 'ok',
            });

            expect(event.t).toBe('ENGINE_CALL_COMPLETED');
            expect(event.trace_id).toBe('trace-1');
            expect(event.phase).toBe('exit');
            expect(event.exit_code).toBe(0);
            expect(event.duration_ms).toBe(42);
        });

        it('runFinishedEvent creates correct structure', () => {
            const event = events.runFinishedEvent({ status: 'continue', reason: 'More work needed' });

            expect(event.t).toBe('RUN_FINISHED');
            expect(event.status).toBe('continue');
            expect(event.reason).toBe('More work needed');
        });

        it('runFailedEvent creates correct structure', () => {
            const event = events.runFailedEvent({ error: 'Something went wrong', code: 'ERR_TEST' });

            expect(event.t).toBe('RUN_FAILED');
            expect(event.error).toBe('Something went wrong');
            expect(event.code).toBe('ERR_TEST');
        });

        it('approvalRequestedEvent creates correct structure', () => {
            const event = events.approvalRequestedEvent({
                id: 'appr_1',
                action: 'git push',
                reason: 'publishes changes',
            });

            expect(event.t).toBe('APPROVAL_REQUESTED');
            expect(event.id).toBe('appr_1');
            expect(event.action).toBe('git push');
        });

        it('approvalGrantedEvent creates correct structure', () => {
            const event = events.approvalGrantedEvent({ id: 'appr_1' });
            expect(event.t).toBe('APPROVAL_GRANTED');
            expect(event.id).toBe('appr_1');
        });

        it('approvalRejectedEvent creates correct structure', () => {
            const event = events.approvalRejectedEvent({ id: 'appr_1', reason: 'nope' });
            expect(event.t).toBe('APPROVAL_REJECTED');
            expect(event.id).toBe('appr_1');
            expect(event.reason).toBe('nope');
        });

        it('toolCallEvent creates correct structure', () => {
            const event = events.toolCallEvent({ tool: 'git', summary: 'status', duration_ms: 12 });
            expect(event.t).toBe('TOOL_CALL');
            expect(event.tool).toBe('git');
            expect(event.duration_ms).toBe(12);
        });

        it('recoveryDetectedEvent creates correct structure', () => {
            const event = events.recoveryDetectedEvent({
                incomplete_run_id: 'old-run',
                stage: 'execute',
            });

            expect(event.t).toBe('RECOVERY_DETECTED');
            expect(event.incomplete_run_id).toBe('old-run');
            expect(event.stage).toBe('execute');
        });

        it('stateUpdatedEvent creates correct structure', () => {
            const event = events.stateUpdatedEvent({
                field: 'goal',
                old_value: 'Old goal',
                new_value: 'New goal',
            });

            expect(event.t).toBe('STATE_UPDATED');
            expect(event.field).toBe('goal');
            expect(event.old_value).toBe('Old goal');
            expect(event.new_value).toBe('New goal');
        });

        it('workingSetRewrittenEvent creates correct structure', () => {
            const event = events.workingSetRewrittenEvent({
                original_bytes: 5000,
                new_bytes: 4000,
                reason: 'exceeded cap',
            });

            expect(event.t).toBe('WORKING_SET_REWRITTEN');
            expect(event.original_bytes).toBe(5000);
            expect(event.new_bytes).toBe(4000);
        });
    });
});
