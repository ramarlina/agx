const execa = require('execa');
const fs = require('fs');
const path = require('path');
const os = require('os');

const AGX_PATH = path.join(__dirname, '../../index.js');
const DISABLE_NETWORK = path.join(__dirname, '../helpers/disable-network.cjs');

function runAgx(args, { cwd, env }) {
  const res = execa.sync(process.execPath, [AGX_PATH, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 15000,
    reject: false,
  });

  const stdout = res.stdout || '';
  const stderr = res.stderr || '';

  if (res.exitCode !== 0) {
    const msg = `agx failed (code=${res.exitCode})\nstdout:\n${stdout}\nstderr:\n${stderr}`;
    throw new Error(msg);
  }

  return stdout.trim();
}

describe('CLI local-first E2E (hermetic, no network)', () => {
  jest.setTimeout(30000);

  const originalEnv = { ...process.env };

  let agxHome;
  let repoRoot;

  beforeEach(async () => {
    agxHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agx-local-e2e-home-'));
    repoRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agx-local-e2e-repo-'));
    await fs.promises.mkdir(path.join(repoRoot, '.git'), { recursive: true });
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    try {
      await fs.promises.rm(agxHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
    try {
      await fs.promises.rm(repoRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('new/tasks/run/tail/runs works with AGX_LOCAL=1 and network disabled', async () => {
    const env = {
      ...process.env,
      AGX_HOME: agxHome,
      AGX_LOCAL: '1',
      // Hard-fail if anything attempts outbound network.
      NODE_OPTIONS: `--require ${DISABLE_NETWORK}`,
    };

    // 1) new
    const createdRaw = runAgx(['new', 'Test task for local E2E', '--local', '--json'], {
      cwd: repoRoot,
      env,
    });
    const created = JSON.parse(createdRaw);
    expect(created.success).toBe(true);
    expect(created.project_slug).toBeTruthy();
    expect(created.task_slug).toBeTruthy();

    const projectSlug = created.project_slug;
    const taskSlug = created.task_slug;

    const projectRoot = path.join(agxHome, 'projects', projectSlug);
    const taskRoot = path.join(projectRoot, taskSlug);

    expect(fs.existsSync(path.join(projectRoot, 'project.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'index.json'))).toBe(true);
    expect(fs.existsSync(path.join(taskRoot, 'task.json'))).toBe(true);
    expect(fs.existsSync(path.join(taskRoot, 'working_set.md'))).toBe(true);

    const workingSet = await fs.promises.readFile(path.join(taskRoot, 'working_set.md'), 'utf8');
    expect(workingSet).toMatch(/Working Set/);

    // 2) tasks
    const tasksRaw = runAgx(['tasks', '--local', '--json'], { cwd: repoRoot, env });
    const tasks = JSON.parse(tasksRaw);
    expect(tasks.project_slug).toBe(projectSlug);
    expect(tasks.tasks.map((t) => t.task_slug)).toContain(taskSlug);

    // 3) run
    const runRaw = runAgx(['run', taskSlug, '--local', '--json'], { cwd: repoRoot, env });
    const run = JSON.parse(runRaw);
    expect(run.success).toBe(true);
    expect(run.run_id).toBeTruthy();
    expect(run.stage).toBe('execute');
    expect(run.prompt_path).toBeTruthy();

    const runRoot = path.dirname(run.prompt_path);
    expect(fs.existsSync(path.join(runRoot, 'meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(runRoot, 'prompt.md'))).toBe(true);
    expect(fs.existsSync(path.join(runRoot, 'events.ndjson'))).toBe(true);
    expect(fs.existsSync(path.join(runRoot, 'decision.json'))).toBe(false);

    const eventsNdjson = await fs.promises.readFile(path.join(runRoot, 'events.ndjson'), 'utf8');
    expect(eventsNdjson).toMatch(/"t":"RUN_STARTED"/);
    expect(eventsNdjson).toMatch(/"t":"PROMPT_BUILT"/);

    // 4) tail
    const tailRaw = runAgx(['tail', taskSlug, '--local', '--json'], { cwd: repoRoot, env });
    const tail = JSON.parse(tailRaw);
    expect(tail.run_id).toBe(run.run_id);
    expect(tail.stage).toBe('execute');
    expect(tail.events.length).toBeGreaterThan(0);
    expect(tail.events.map((e) => e.t)).toContain('RUN_STARTED');

    // 5) runs
    const runsRaw = runAgx(['runs', taskSlug, '--local', '--json'], { cwd: repoRoot, env });
    const runs = JSON.parse(runsRaw);
    expect(runs.runs.map((r) => r.run_id)).toContain(run.run_id);
  });
});
