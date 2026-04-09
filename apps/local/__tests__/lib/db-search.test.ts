import { db } from '@/lib/db-instance';
import { randomUUID } from 'crypto';

describe('Task Search Integration', () => {
  const runId = randomUUID();
  const task1Title = `SearchTest Task One ${runId}`;
  const task2Title = `SearchTest Task Two ${runId}`;
  const task1Slug = `search-test-one-${runId}`;
  const task2Slug = `search-test-two-${runId}`;
  
  let task1Id: string;
  let task2Id: string;
  const userId = randomUUID();

  beforeAll(async () => {
    // Give time for previous tests to clear or DB to be ready
    const t1 = await db.createTask(`---\nslug: ${task1Slug}\n---\n# ${task1Title}\n`, userId);
    task1Id = t1.id;
    const t2 = await db.createTask(`---\nslug: ${task2Slug}\n---\n# ${task2Title}\n`, userId);
    task2Id = t2.id;
  });

  afterAll(async () => {
    if (task1Id) await db.deleteTask(task1Id);
    if (task2Id) await db.deleteTask(task2Id);
  });

  test('search finds task by title substring', async () => {
    const results = await db.getTasks(userId, { search: 'Task One' });
    const ids = results.map(t => t.id);
    expect(ids).toContain(task1Id);
    expect(ids).not.toContain(task2Id);
  });

  test('search finds task by slug substring', async () => {
    const results = await db.getTasks(userId, { search: 'two' });
    const ids = results.map(t => t.id);
    expect(ids).toContain(task2Id);
    expect(ids).not.toContain(task1Id);
  });

  test('search finds task by partial ID', async () => {
    // Partial ID search (first 8 chars)
    const partialId = task1Id.slice(0, 8);
    const results = await db.getTasks(userId, { search: partialId });
    const ids = results.map(t => t.id);
    // This is expected to fail currently if partial ID search is not implemented
    expect(ids).toContain(task1Id);
    // And should not contain the other task
    expect(ids).not.toContain(task2Id);
  });
});
