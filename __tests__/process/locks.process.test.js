const execa = require('execa');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('process: cross-process task lock', () => {
  jest.setTimeout(20000);

  const originalEnv = { ...process.env };

  let agxHome;
  let outPath;
  let child;

  beforeEach(async () => {
    agxHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agx-proc-lock-'));
    outPath = path.join(agxHome, 'child-info.json');
  });

  afterEach(async () => {
    if (child) {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    child = null;

    process.env = { ...originalEnv };
    try {
      await fs.promises.rm(agxHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('second acquire fails while held; succeeds after child exits and releases', async () => {
    const fixture = path.join(__dirname, '../fixtures/hold-lock.cjs');
    const storage = require('../../lib/storage');

    const env = {
      ...process.env,
      AGX_HOME: agxHome,
      PROJECT_SLUG: 'proc-project',
      TASK_SLUG: 'proc-task',
      OUT_PATH: outPath,
    };

    child = execa(process.execPath, [fixture], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      reject: false,
    });

    // Wait for READY signal.
    await new Promise((resolve, reject) => {
      const onData = (buf) => {
        if (buf.toString('utf8').includes('READY')) {
          child.stdout.off('data', onData);
          resolve();
        }
      };
      child.stdout.on('data', onData);
      child.on('exit', (code) => reject(new Error(`child exited early: ${code}`)));
      child.on('error', reject);
    });

    const info = JSON.parse(await fs.promises.readFile(outPath, 'utf8'));
    expect(fs.existsSync(info.lockPath)).toBe(true);

    // Second acquire should fail fast while lock is held.
    await expect(storage.acquireTaskLock(info.taskRoot)).rejects.toThrow(/locked|EEXIST/i);

    // Terminate child; it should release the lock on SIGTERM.
    child.kill('SIGTERM');
    await new Promise((resolve) => child.on('exit', resolve));

    // Now acquire should succeed.
    const handle = await storage.acquireTaskLock(info.taskRoot);
    await storage.releaseTaskLock(handle);
  });
});
