const execa = require('execa');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('process: SIGTERM drain finalizes run and releases lock', () => {
  jest.setTimeout(20000);

  const originalEnv = { ...process.env };

  let agxHome;
  let outPath;
  let child;

  beforeEach(async () => {
    agxHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agx-proc-sigterm-'));
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

  test('on SIGTERM, decision.json exists and lock is removed', async () => {
    const fixture = path.join(__dirname, '../fixtures/sigterm-drain.cjs');

    const env = {
      ...process.env,
      AGX_HOME: agxHome,
      PROJECT_SLUG: 'sigterm-project',
      TASK_SLUG: 'sigterm-task',
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
    expect(fs.existsSync(info.decisionPath)).toBe(false);

    child.kill('SIGTERM');
    await new Promise((resolve) => child.on('exit', resolve));

    // Run should be finalized on drain.
    const decisionRaw = await fs.promises.readFile(info.decisionPath, 'utf8');
    const decision = JSON.parse(decisionRaw);
    expect(decision.status).toBeTruthy();

    // Lock should be released.
    expect(fs.existsSync(info.lockPath)).toBe(false);
  });
});
