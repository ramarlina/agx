/**
 * Child process fixture: creates a run and finalizes it on SIGTERM ("drain").
 *
 * Env:
 * - AGX_HOME: required
 * - PROJECT_SLUG: optional (default "sigterm-project")
 * - TASK_SLUG: optional (default "sigterm-task")
 * - OUT_PATH: optional path to write JSON with run info
 */

const fs = require('fs');
const path = require('path');

async function main() {
  const storage = require('../../lib/storage');

  const projectSlug = process.env.PROJECT_SLUG || 'sigterm-project';
  const taskSlug = process.env.TASK_SLUG || 'sigterm-task';
  const outPath = process.env.OUT_PATH || null;

  await storage.writeProjectState(projectSlug, { repo_path: process.cwd() });
  await storage.createTask(projectSlug, { user_request: 'SIGTERM drain test', taskSlug });

  const taskRoot = storage.taskRoot(projectSlug, taskSlug);
  const lockHandle = await storage.acquireTaskLock(taskRoot);

  const run = await storage.createRun({
    projectSlug,
    taskSlug,
    stage: 'execute',
    engine: 'claude',
  });

  await storage.updateLastRun(projectSlug, taskSlug, 'execute', run.run_id);
  await storage.writePrompt(run, '# Prompt\n\nSIGTERM drain harness\n');

  const payload = {
    projectSlug,
    taskSlug,
    runId: run.run_id,
    runRoot: run.paths.root,
    decisionPath: run.paths.decision,
    lockPath: path.join(taskRoot, '.lock'),
    pid: process.pid,
  };

  if (outPath) {
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, JSON.stringify(payload), 'utf8');
  }

  process.stdout.write('READY\n');

  const drainAndExit = async () => {
    console.log('drain handler invoked');
    try {
      // Ensure decision.json exists to mark the run immutable.
      console.log('finalize run start', run.paths.decision);
      await storage.writeOutput(run, 'Interrupted by SIGTERM\n');
      await storage.finalizeRun(run, { status: 'failed', reason: 'SIGTERM drain' });
      console.log('finalize run complete');
    } catch {
      // best-effort
    }
    try {
      await storage.releaseTaskLock(lockHandle);
    } catch {
      // best-effort
    }
    process.exit(0);
  };

  process.on('SIGTERM', drainAndExit);
  process.on('SIGINT', drainAndExit);

  // Keep the process alive until signaled.
  setInterval(() => {}, 1000);
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});
