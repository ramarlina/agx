/**
 * Tests for lib/storage/db.js (agent_memory)
 * Covers: migration idempotency, CRUD, content_hash, duplicate suppression.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const originalEnv = { ...process.env };

describe('agent_memory storage (db.js)', () => {
    let testDir;
    let db;

    beforeEach(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agx-db-test-'));
        process.env.AGX_HOME = testDir;

        jest.resetModules();
        db = require('../../../lib/storage/db');
    });

    afterEach(() => {
        // Close the SQLite connection by resetting module cache
        jest.resetModules();
        try {
            fs.rmSync(testDir, { recursive: true, force: true });
        } catch { /* ignore */ }
        process.env = { ...originalEnv };
    });

    // ----------------------------------------------------------------
    // Migration smoke test
    // ----------------------------------------------------------------
    describe('migration', () => {
        it('creates agent_memory table on first open', () => {
            const conn = db.openDb();
            const tables = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_memory'")
                .all();
            expect(tables).toHaveLength(1);
        });

        it('records migration in _migrations table', () => {
            const conn = db.openDb();
            const rows = conn.prepare('SELECT * FROM _migrations WHERE name=?').all('create_agent_memory');
            expect(rows).toHaveLength(1);
            expect(rows[0].version).toBe(1);
        });

        it('is idempotent — running openDb twice does not error or duplicate migration', () => {
            db.openDb();
            const conn2 = db.openDb(); // cached; should not re-run
            const rows = conn2.prepare('SELECT * FROM _migrations').all();
            expect(rows).toHaveLength(1);
        });
    });

    // ----------------------------------------------------------------
    // contentHash
    // ----------------------------------------------------------------
    describe('contentHash', () => {
        it('returns a 64-char hex string (SHA-256)', () => {
            const h = db.contentHash('hello world');
            expect(h).toMatch(/^[a-f0-9]{64}$/);
        });

        it('same content → same hash', () => {
            expect(db.contentHash('abc')).toBe(db.contentHash('abc'));
        });

        it('different content → different hash', () => {
            expect(db.contentHash('abc')).not.toBe(db.contentHash('xyz'));
        });
    });

    // ----------------------------------------------------------------
    // insertMemory — happy path
    // ----------------------------------------------------------------
    describe('insertMemory', () => {
        const base = {
            id: 'mem-001',
            agent_id: 'agent-a',
            task_id: 'task-1',
            memory_type: 'outcome',
            content: 'Task completed successfully',
        };

        it('inserts a new memory and returns true', () => {
            const inserted = db.insertMemory(base);
            expect(inserted).toBe(true);
        });

        it('stores all required fields', () => {
            db.insertMemory(base);
            const rows = db.getMemoriesByTask(base.task_id);
            expect(rows).toHaveLength(1);
            const row = rows[0];
            expect(row.id).toBe(base.id);
            expect(row.agent_id).toBe(base.agent_id);
            expect(row.task_id).toBe(base.task_id);
            expect(row.memory_type).toBe(base.memory_type);
            expect(row.content).toBe(base.content);
            expect(row.content_hash).toBe(db.contentHash(base.content));
            expect(typeof row.created_at).toBe('number');
        });

        it('accepts all four memory_type values', () => {
            const types = ['outcome', 'decision', 'pattern', 'gotcha'];
            types.forEach((memory_type, i) => {
                const inserted = db.insertMemory({ ...base, id: `mem-${i}`, memory_type, content: `content ${i}` });
                expect(inserted).toBe(true);
            });
            expect(db.getMemoriesByTask(base.task_id)).toHaveLength(4);
        });
    });

    // ----------------------------------------------------------------
    // insertMemory — idempotency (duplicate suppression)
    // ----------------------------------------------------------------
    describe('insertMemory idempotency', () => {
        const base = {
            id: 'mem-idem-1',
            agent_id: 'agent-b',
            task_id: 'task-idem',
            memory_type: 'decision',
            content: 'Use SQLite for storage',
        };

        it('returns false on duplicate (same task_id, memory_type, content)', () => {
            db.insertMemory(base);
            const second = db.insertMemory({ ...base, id: 'mem-idem-2' }); // different id, same content
            expect(second).toBe(false);
        });

        it('duplicate insert produces exactly one row', () => {
            db.insertMemory(base);
            db.insertMemory({ ...base, id: 'mem-idem-3' });
            db.insertMemory({ ...base, id: 'mem-idem-4' });
            expect(db.getMemoriesByTask(base.task_id)).toHaveLength(1);
        });

        it('same content in different task_id is NOT a duplicate', () => {
            db.insertMemory(base);
            const other = db.insertMemory({ ...base, id: 'mem-idem-5', task_id: 'task-other' });
            expect(other).toBe(true);
        });

        it('same task_id + content but different memory_type is NOT a duplicate', () => {
            db.insertMemory(base);
            const other = db.insertMemory({ ...base, id: 'mem-idem-6', memory_type: 'pattern' });
            expect(other).toBe(true);
        });
    });

    // ----------------------------------------------------------------
    // insertMemory — validation
    // ----------------------------------------------------------------
    describe('insertMemory validation', () => {
        it('throws on invalid memory_type', () => {
            expect(() => db.insertMemory({
                id: 'bad',
                agent_id: 'a',
                task_id: 't',
                memory_type: 'invalid',
                content: 'x',
            })).toThrow(/Invalid memory_type/);
        });
    });

    // ----------------------------------------------------------------
    // getMemoriesByTask
    // ----------------------------------------------------------------
    describe('getMemoriesByTask', () => {
        it('returns empty array when no memories exist', () => {
            expect(db.getMemoriesByTask('nonexistent')).toEqual([]);
        });

        it('returns only memories for the requested task', () => {
            db.insertMemory({ id: 'm1', agent_id: 'a', task_id: 'task-A', memory_type: 'outcome', content: 'A' });
            db.insertMemory({ id: 'm2', agent_id: 'a', task_id: 'task-B', memory_type: 'outcome', content: 'B' });
            const rows = db.getMemoriesByTask('task-A');
            expect(rows).toHaveLength(1);
            expect(rows[0].task_id).toBe('task-A');
        });
    });

    // ----------------------------------------------------------------
    // getMemoriesByAgent
    // ----------------------------------------------------------------
    describe('getMemoriesByAgent', () => {
        it('returns empty array when no memories exist', () => {
            expect(db.getMemoriesByAgent('nobody')).toEqual([]);
        });

        it('returns memories across tasks for the agent', () => {
            db.insertMemory({ id: 'x1', agent_id: 'agent-x', task_id: 'task-1', memory_type: 'outcome', content: 'one' });
            db.insertMemory({ id: 'x2', agent_id: 'agent-x', task_id: 'task-2', memory_type: 'pattern', content: 'two' });
            db.insertMemory({ id: 'y1', agent_id: 'agent-y', task_id: 'task-1', memory_type: 'outcome', content: 'three' });
            const rows = db.getMemoriesByAgent('agent-x');
            expect(rows).toHaveLength(2);
            expect(rows.every(r => r.agent_id === 'agent-x')).toBe(true);
        });
    });
});
