/**
 * SQLite database for agx structured storage.
 *
 * DB location: ${AGX_HOME}/agx.db
 *
 * Tables:
 *   agent_memory  - persisted agent memories (outcomes, decisions, patterns, gotchas)
 *
 * Migration strategy: inline, run-once CREATE TABLE IF NOT EXISTS on first open.
 * content_hash = SHA-256 hex of content (first 64 chars suffices; full 64 used here).
 * Unique constraint on (task_id, memory_type, content_hash) prevents duplicate memories
 * across reruns/retries.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

// ============================================================
// Paths
// ============================================================

function agxHome() {
    return process.env.AGX_HOME || path.join(os.homedir(), '.agx');
}

function dbPath() {
    return path.join(agxHome(), 'agx.db');
}

// ============================================================
// Migration
// ============================================================

const MIGRATIONS = [
    {
        version: 1,
        name: 'create_agent_memory',
        sql: `
            CREATE TABLE IF NOT EXISTS agent_memory (
                id           TEXT    NOT NULL PRIMARY KEY,
                agent_id     TEXT    NOT NULL,
                task_id      TEXT    NOT NULL,
                memory_type  TEXT    NOT NULL CHECK(memory_type IN ('outcome', 'decision', 'pattern', 'gotcha')),
                content      TEXT    NOT NULL,
                content_hash TEXT    NOT NULL,
                created_at   INTEGER NOT NULL,
                UNIQUE (task_id, memory_type, content_hash)
            );
            CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_id ON agent_memory(agent_id);
            CREATE INDEX IF NOT EXISTS idx_agent_memory_task_id  ON agent_memory(task_id);
        `,
    },
];

function ensureMigrationsTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
            version   INTEGER NOT NULL PRIMARY KEY,
            name      TEXT    NOT NULL,
            applied_at INTEGER NOT NULL
        );
    `);
}

function runMigrations(db) {
    ensureMigrationsTable(db);
    const applied = new Set(
        db.prepare('SELECT version FROM _migrations').all().map(r => r.version)
    );

    for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) continue;
        db.transaction(() => {
            db.exec(migration.sql);
            db.prepare('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)')
                .run(migration.version, migration.name, Date.now());
        })();
    }
}

// ============================================================
// Singleton
// ============================================================

let _db = null;

/**
 * Open (or return cached) the agx SQLite database.
 * Runs pending migrations on first open.
 */
function openDb() {
    if (_db) return _db;
    const home = agxHome();
    if (!fs.existsSync(home)) fs.mkdirSync(home, { recursive: true });
    _db = new Database(dbPath());
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    runMigrations(_db);
    return _db;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Compute the content_hash for a memory entry.
 * SHA-256 hex of the UTF-8 content string.
 */
function contentHash(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

// ============================================================
// CRUD: agent_memory
// ============================================================

const ALLOWED_MEMORY_TYPES = new Set(['outcome', 'decision', 'pattern', 'gotcha']);

/**
 * Insert a memory record. Idempotent: duplicate (task_id, memory_type, content_hash) is silently ignored.
 * @param {Object} record
 * @param {string} record.id - UUID
 * @param {string} record.agent_id
 * @param {string} record.task_id
 * @param {'outcome'|'decision'|'pattern'|'gotcha'} record.memory_type
 * @param {string} record.content
 * @returns {boolean} true if inserted, false if duplicate
 */
function insertMemory({ id, agent_id, task_id, memory_type, content }) {
    if (!ALLOWED_MEMORY_TYPES.has(memory_type)) {
        throw new Error(`Invalid memory_type: ${memory_type}. Must be one of: ${[...ALLOWED_MEMORY_TYPES].join(', ')}`);
    }
    const db = openDb();
    const hash = contentHash(content);
    const created_at = Date.now();
    const result = db.prepare(`
        INSERT OR IGNORE INTO agent_memory (id, agent_id, task_id, memory_type, content, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, agent_id, task_id, memory_type, content, hash, created_at);
    return result.changes > 0;
}

/**
 * Retrieve all memories for a given task_id.
 * @param {string} task_id
 * @returns {Array<MemoryRow>}
 */
function getMemoriesByTask(task_id) {
    const db = openDb();
    return db.prepare('SELECT * FROM agent_memory WHERE task_id = ? ORDER BY created_at ASC').all(task_id);
}

/**
 * Retrieve all memories for a given agent_id (cross-task context).
 * @param {string} agent_id
 * @returns {Array<MemoryRow>}
 */
function getMemoriesByAgent(agent_id) {
    const db = openDb();
    return db.prepare('SELECT * FROM agent_memory WHERE agent_id = ? ORDER BY created_at ASC').all(agent_id);
}

module.exports = { openDb, dbPath, contentHash, insertMemory, getMemoriesByTask, getMemoriesByAgent };
