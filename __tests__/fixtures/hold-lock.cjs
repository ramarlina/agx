/**
 * Child process fixture: acquires a task lock and holds it until SIGTERM.
 *
 * Env:
 * - AGX_HOME: required
 * - PROJECT_SLUG: optional (default "proc-project")
 * - TASK_SLUG: optional (default "proc-task")
 * - OUT_PATH: optional path to write JSON with lock info
 */

const fs = require('fs');
const path = require('path');

async function main() {
  const storage = require('../../lib/storage');

  const projectSlug = process.env.PROJECT_SLUG || 'proc-project';
  const taskSlug = process.env.TASK_SLUG || 'proc-task';
  const outPath = process.env.OUT_PATH || null;

  await storage.writeProjectState(projectSlug, { repo_path: process.cwd() });
  await storage.createTask(projectSlug, { user_request: 'Process test task', taskSlug });

  const taskRoot = storage.taskRoot(projectSlug, taskSlug);
  const lockHandle = await storage.acquireTaskLock(taskRoot);

  const payload = {
    projectSlug,
    taskSlug,
    taskRoot,
    lockPath: path.join(taskRoot, '.lock'),
    pid: process.pid,
  };

  if (outPath) {
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, JSON.stringify(payload), 'utf8');
  }

  process.stdout.write('READY\n');

  const shutdown = async () => {
    try {
      await storage.releaseTaskLock(lockHandle);
    } catch {
      // best-effort
    }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Keep the process alive.
  setInterval(() => {}, 1000);
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});

