/**
 * Integration tests for /api/memories routes (attachMemoryRoutes).
 * Uses a real in-memory SQLite DB (via AGX_HOME=tmp) and a minimal Express-like mock.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const originalEnv = { ...process.env };

// Minimal request/response mock helpers
function makeReq({ body = {}, query = {} } = {}) {
    return { body, query };
}

function makeRes() {
    const res = {
        _status: 200,
        _body: null,
        status(code) { this._status = code; return this; },
        json(body) { this._body = body; return this; },
    };
    return res;
}

describe('/api/memories routes (attachMemoryRoutes)', () => {
    let testDir;
    let attachMemoryRoutes;
    let app;

    beforeEach(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agx-routes-test-'));
        process.env.AGX_HOME = testDir;

        jest.resetModules();
        ({ attachMemoryRoutes } = require('../../../lib/orchestrator/index'));

        // Minimal express-like app stub
        app = { _routes: { POST: {}, GET: {} } };
        app.post = (path, handler) => { app._routes.POST[path] = handler; };
        app.get  = (path, handler) => { app._routes.GET[path]  = handler; };

        attachMemoryRoutes(app);
    });

    afterEach(() => {
        jest.resetModules();
        try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
        process.env = { ...originalEnv };
    });

    // ----------------------------------------------------------------
    // POST /api/memories — happy path
    // ----------------------------------------------------------------
    describe('POST /api/memories', () => {
        const handler = () => app._routes.POST['/api/memories'];

        it('inserts a new memory and returns 201', () => {
            const req = makeReq({ body: { agent_id: 'a1', task_id: 't1', memory_type: 'outcome', content: 'done' } });
            const res = makeRes();
            handler()(req, res);
            expect(res._status).toBe(201);
            expect(res._body).toEqual({ ok: true, inserted: true });
        });

        it('returns 200 on duplicate (idempotent)', () => {
            const body = { agent_id: 'a1', task_id: 't1', memory_type: 'outcome', content: 'done' };
            handler()(makeReq({ body }), makeRes());
            const res2 = makeRes();
            handler()(makeReq({ body }), res2);
            expect(res2._status).toBe(200);
            expect(res2._body).toEqual({ ok: true, inserted: false });
        });
    });

    // ----------------------------------------------------------------
    // POST /api/memories — validation errors
    // ----------------------------------------------------------------
    describe('POST /api/memories validation', () => {
        const handler = () => app._routes.POST['/api/memories'];

        it('returns 400 when agent_id is missing', () => {
            const res = makeRes();
            handler()(makeReq({ body: { task_id: 't', memory_type: 'outcome', content: 'x' } }), res);
            expect(res._status).toBe(400);
            expect(res._body.error).toMatch(/Missing required/);
        });

        it('returns 400 when task_id is missing', () => {
            const res = makeRes();
            handler()(makeReq({ body: { agent_id: 'a', memory_type: 'outcome', content: 'x' } }), res);
            expect(res._status).toBe(400);
        });

        it('returns 400 when memory_type is missing', () => {
            const res = makeRes();
            handler()(makeReq({ body: { agent_id: 'a', task_id: 't', content: 'x' } }), res);
            expect(res._status).toBe(400);
        });

        it('returns 400 when content is missing', () => {
            const res = makeRes();
            handler()(makeReq({ body: { agent_id: 'a', task_id: 't', memory_type: 'outcome' } }), res);
            expect(res._status).toBe(400);
        });

        it('returns 400 for invalid memory_type', () => {
            const res = makeRes();
            handler()(makeReq({ body: { agent_id: 'a', task_id: 't', memory_type: 'unknown', content: 'x' } }), res);
            expect(res._status).toBe(400);
            expect(res._body.error).toMatch(/Invalid memory_type/);
        });
    });

    // ----------------------------------------------------------------
    // GET /api/memories — happy path
    // ----------------------------------------------------------------
    describe('GET /api/memories', () => {
        const postHandler = () => app._routes.POST['/api/memories'];
        const getHandler  = () => app._routes.GET['/api/memories'];

        beforeEach(() => {
            // Seed two memories for task-get
            postHandler()(makeReq({ body: { agent_id: 'ag1', task_id: 'task-get', memory_type: 'outcome', content: 'first' } }), makeRes());
            postHandler()(makeReq({ body: { agent_id: 'ag1', task_id: 'task-get', memory_type: 'pattern', content: 'second' } }), makeRes());
        });

        it('returns memories by task_id', () => {
            const res = makeRes();
            getHandler()(makeReq({ query: { task_id: 'task-get' } }), res);
            expect(res._status).toBe(200);
            expect(Array.isArray(res._body)).toBe(true);
            expect(res._body).toHaveLength(2);
        });

        it('returns memories by agent_id', () => {
            const res = makeRes();
            getHandler()(makeReq({ query: { agent_id: 'ag1' } }), res);
            expect(res._status).toBe(200);
            expect(res._body).toHaveLength(2);
            expect(res._body.every(r => r.agent_id === 'ag1')).toBe(true);
        });

        it('returns empty array for unknown task_id', () => {
            const res = makeRes();
            getHandler()(makeReq({ query: { task_id: 'nonexistent' } }), res);
            expect(res._status).toBe(200);
            expect(res._body).toEqual([]);
        });
    });

    // ----------------------------------------------------------------
    // GET /api/memories — validation
    // ----------------------------------------------------------------
    describe('GET /api/memories validation', () => {
        it('returns 400 when neither task_id nor agent_id provided', () => {
            const res = makeRes();
            app._routes.GET['/api/memories'](makeReq({ query: {} }), res);
            expect(res._status).toBe(400);
            expect(res._body.error).toMatch(/task_id or agent_id/);
        });
    });
});
