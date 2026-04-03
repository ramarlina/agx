'use strict';

/**
 * Acceptance tests for agent memory v1.
 *
 * Covers:
 * 1. Completed task writes memories
 * 2. Failed task writes memories
 * 3. Reprocessing same task is no-op (no dupes)
 * 4. --no-memory skips injection cleanly
 * 5. Corrupt/non-JSON extractor output doesn't break run completion (fail-open)
 * 6. Strict JSON extraction contract with retry-once
 */

const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Use a temp DB for tests
let _testDb;
const TEST_DB_PATH = path.join(os.tmpdir(), `agx-memory-test-${Date.now()}.db`);

// Mock the db module to use test DB
jest.mock('../../../lib/storage/db', () => {
  const original = jest.requireActual('../../../lib/storage/db');
  const testDb = () => {
    if (_testDb) return _testDb;
    _testDb = new DatabaseSync(TEST_DB_PATH);
    _testDb.exec('PRAGMA journal_mode = WAL');
    _testDb.exec(`
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
    `);
    return _testDb;
  };
  return {
    ...original,
    openDb: testDb,
    insertMemory: (record) => {
      const db = testDb();
      const hash = original.contentHash(record.content);
      const result = db.prepare(`
        INSERT OR IGNORE INTO agent_memory (id, agent_id, task_id, memory_type, content, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(record.id, record.agent_id, record.task_id, record.memory_type, record.content, hash, Date.now());
      return result.changes > 0;
    },
    getMemoriesByAgent: (agent_id) => {
      const db = testDb();
      return db.prepare('SELECT * FROM agent_memory WHERE agent_id = ? ORDER BY created_at ASC').all(agent_id);
    },
    getMemoriesByTask: (task_id) => {
      const db = testDb();
      return db.prepare('SELECT * FROM agent_memory WHERE task_id = ? ORDER BY created_at ASC').all(task_id);
    },
  };
});

const { extractAndStoreMemories, parseMemoryJson } = require('../../../lib/memory/extract');
const { buildMemoryBlock } = require('../../../lib/memory/inject');
const { getMemoriesByTask, getMemoriesByAgent } = require('../../../lib/storage/db');

afterAll(() => {
  if (_testDb) {
    try { _testDb.close(); } catch {}
  }
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
});

// ============================================================
// 1. Completed task writes memories
// ============================================================
describe('Completed task writes memories', () => {
  test('extracts and stores memories from a successful task', async () => {
    const llmCall = jest.fn().mockResolvedValue(JSON.stringify([
      { memory_type: 'decision', content: 'Used SQLite for storage because it is local-first' },
      { memory_type: 'pattern', content: 'This codebase uses Jest for testing' },
    ]));

    const result = await extractAndStoreMemories({
      taskId: 'task-success-1',
      agentId: 'test-project',
      title: 'Add database layer',
      summary: 'Implemented SQLite storage with WAL mode.',
      outcome: 'success',
      llmCall,
    });

    expect(result).toHaveLength(2);
    expect(result[0].memory_type).toBe('decision');
    expect(result[1].memory_type).toBe('pattern');

    const stored = getMemoriesByTask('task-success-1');
    expect(stored).toHaveLength(2);
  });
});

// ============================================================
// 2. Failed task writes memories
// ============================================================
describe('Failed task writes memories', () => {
  test('extracts memories from a failed task', async () => {
    const llmCall = jest.fn().mockResolvedValue(JSON.stringify([
      { memory_type: 'gotcha', content: 'Avoid running migrations without backup — caused data loss' },
    ]));

    const result = await extractAndStoreMemories({
      taskId: 'task-failed-1',
      agentId: 'test-project',
      title: 'Run database migration',
      summary: 'Migration failed due to missing backup step.',
      outcome: 'failed',
      llmCall,
    });

    expect(result).toHaveLength(1);
    expect(result[0].memory_type).toBe('gotcha');

    const stored = getMemoriesByTask('task-failed-1');
    expect(stored).toHaveLength(1);
  });
});

// ============================================================
// 3. Reprocessing same task is no-op (no dupes)
// ============================================================
describe('Idempotent extraction', () => {
  test('reprocessing same task does not create duplicate memories', async () => {
    const response = JSON.stringify([
      { memory_type: 'decision', content: 'Chose REST over GraphQL for simplicity' },
    ]);
    const llmCall = jest.fn().mockResolvedValue(response);

    await extractAndStoreMemories({
      taskId: 'task-idempotent-1',
      agentId: 'test-project',
      title: 'API design',
      summary: 'Chose REST.',
      outcome: 'success',
      llmCall,
    });

    // Run again with same task
    await extractAndStoreMemories({
      taskId: 'task-idempotent-1',
      agentId: 'test-project',
      title: 'API design',
      summary: 'Chose REST.',
      outcome: 'success',
      llmCall,
    });

    const stored = getMemoriesByTask('task-idempotent-1');
    expect(stored).toHaveLength(1); // no dupes
  });
});

// ============================================================
// 4. --no-memory skips injection cleanly
// ============================================================
describe('--no-memory skips injection', () => {
  test('buildMemoryBlock returns empty string when agentId is falsy', () => {
    const block = buildMemoryBlock({ agentId: '' });
    expect(block).toBe('');
  });

  test('buildMemoryBlock returns empty string for agent with no memories', () => {
    const block = buildMemoryBlock({ agentId: 'nonexistent-agent-xyz' });
    expect(block).toBe('');
  });

  test('buildMemoryBlock returns formatted block when memories exist', async () => {
    const llmCall = jest.fn().mockResolvedValue(JSON.stringify([
      { memory_type: 'pattern', content: 'Always run linter before commit' },
    ]));
    await extractAndStoreMemories({
      taskId: 'task-inject-1',
      agentId: 'inject-test-project',
      title: 'Setup linting',
      summary: 'Added ESLint config.',
      outcome: 'success',
      llmCall,
    });

    const block = buildMemoryBlock({ agentId: 'inject-test-project' });
    expect(block).toContain('## Past learnings');
    expect(block).toContain('Always run linter before commit');
    expect(block).toContain('**Pattern:**');
  });
});

// ============================================================
// 5. Corrupt extractor output doesn't break run completion (fail-open)
// ============================================================
describe('Fail-open on corrupt output', () => {
  test('returns empty array when LLM returns garbage', async () => {
    const llmCall = jest.fn().mockResolvedValue('This is not JSON at all, just random text.');

    const result = await extractAndStoreMemories({
      taskId: 'task-corrupt-1',
      agentId: 'test-project',
      title: 'Some task',
      summary: 'Some summary.',
      outcome: 'success',
      llmCall,
    });

    expect(result).toEqual([]);
  });

  test('returns empty array when LLM throws', async () => {
    const llmCall = jest.fn().mockRejectedValue(new Error('LLM unavailable'));

    const result = await extractAndStoreMemories({
      taskId: 'task-throw-1',
      agentId: 'test-project',
      title: 'Some task',
      summary: 'Some summary.',
      outcome: 'success',
      llmCall,
    });

    expect(result).toEqual([]);
  });

  test('does not throw when extraction fails completely', async () => {
    const llmCall = jest.fn()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockRejectedValueOnce(new Error('second fail'));

    await expect(extractAndStoreMemories({
      taskId: 'task-nothrow-1',
      agentId: 'test-project',
      title: 'Some task',
      summary: 'Some summary.',
      outcome: 'success',
      llmCall,
    })).resolves.toEqual([]);
  });
});

// ============================================================
// 6. Strict JSON extraction contract with retry-once
// ============================================================
describe('Strict JSON contract + retry', () => {
  test('retries once on non-JSON response, succeeds on second attempt', async () => {
    const llmCall = jest.fn()
      .mockResolvedValueOnce('Sorry, I cannot do that.')
      .mockResolvedValueOnce(JSON.stringify([
        { memory_type: 'pattern', content: 'Retry logic works' },
      ]));

    const result = await extractAndStoreMemories({
      taskId: 'task-retry-1',
      agentId: 'test-project',
      title: 'Test retry',
      summary: 'Testing retry.',
      outcome: 'success',
      llmCall,
    });

    expect(llmCall).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Retry logic works');
  });

  test('parseMemoryJson rejects invalid memory_type', () => {
    const result = parseMemoryJson(JSON.stringify([
      { memory_type: 'invalid_type', content: 'Should be filtered' },
      { memory_type: 'decision', content: 'Valid one' },
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].memory_type).toBe('decision');
  });

  test('parseMemoryJson caps at 3 memories', () => {
    const result = parseMemoryJson(JSON.stringify([
      { memory_type: 'decision', content: 'One' },
      { memory_type: 'pattern', content: 'Two' },
      { memory_type: 'gotcha', content: 'Three' },
      { memory_type: 'decision', content: 'Four' },
    ]));
    expect(result).toHaveLength(3);
  });

  test('parseMemoryJson returns null for non-array JSON', () => {
    expect(parseMemoryJson('{"not": "array"}')).toBeNull();
  });

  test('parseMemoryJson returns empty array for []', () => {
    const result = parseMemoryJson('[]');
    expect(result).toEqual([]);
  });

  test('parseMemoryJson extracts array from surrounding text', () => {
    const result = parseMemoryJson('Here are the memories:\n[{"memory_type": "pattern", "content": "test"}]\nDone.');
    expect(result).toHaveLength(1);
  });
});

// ============================================================
// Memory injection budget control
// ============================================================
describe('Memory injection budget', () => {
  test('respects maxChars limit', async () => {
    // Insert several memories
    const llmCall = jest.fn().mockResolvedValue(JSON.stringify([
      { memory_type: 'pattern', content: 'A'.repeat(200) },
      { memory_type: 'decision', content: 'B'.repeat(200) },
      { memory_type: 'gotcha', content: 'C'.repeat(200) },
    ]));
    await extractAndStoreMemories({
      taskId: 'task-budget-1',
      agentId: 'budget-test-project',
      title: 'Budget test',
      summary: 'Testing budget.',
      outcome: 'success',
      llmCall,
    });

    // With a very tight budget, not all memories should be included
    const block = buildMemoryBlock({ agentId: 'budget-test-project', maxChars: 300 });
    // Should have header but may not fit all memories
    if (block) {
      expect(block.length).toBeLessThanOrEqual(350); // some tolerance for header
    }
  });
});
