/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { c } = require('../ui/colors');
const { CONFIG_DIR, DAEMON_PID_FILE, DAEMON_LOG_FILE, DAEMON_STATE_FILE, TASK_LOGS_DIR, BOARD_PID_FILE, BOARD_LOG_FILE, BOARD_ENV_FILE } = require('../config/paths');
const { prompt } = require('./configStore');
const { sleep } = require('./util');

// Embedded orchestrator worker (pg-boss) runtime (optional). Keep legacy filenames for backward compatibility.
const WORKER_PID_FILE = path.join(CONFIG_DIR, 'orchestrator-worker.pid');
const WORKER_LOG_FILE = path.join(CONFIG_DIR, 'orchestrator-worker.log');

// Bundled runtime roots (standalone build tracing preserves an absolute-path-like subtree).
const PACKAGED_AGX_CLOUD_ROOT = path.join(__dirname, 'cloud-runtime', 'standalone');
// Legacy default path (only correct if the standalone build was traced under `/Users/<name>`).
const PACKAGED_AGX_CLOUD_DIR = path.join(PACKAGED_AGX_CLOUD_ROOT, 'Projects', 'Agents', 'agx-cloud');
const LOCAL_AGX_CLOUD_DIR = path.resolve(__dirname, '..', 'agx-cloud');

let cachedPackagedAgxCloudDir;
function resolvePackagedAgxCloudDir() {
  if (cachedPackagedAgxCloudDir !== undefined) return cachedPackagedAgxCloudDir;

  const hasFile = (dir, rel) => {
    try { return fs.existsSync(path.join(dir, rel)); } catch { return false; }
  };

  const isStandaloneAppDir = (dir) => {
    if (!hasFile(dir, 'server.js')) return false;
    if (!hasFile(dir, 'package.json')) return false;
    if (hasFile(dir, path.join('.next', 'BUILD_ID'))) return true;
    if (hasFile(dir, path.join('.next', 'package.json'))) return true;
    return false;
  };

  if (isStandaloneAppDir(PACKAGED_AGX_CLOUD_DIR)) {
    cachedPackagedAgxCloudDir = PACKAGED_AGX_CLOUD_DIR;
    return cachedPackagedAgxCloudDir;
  }

  const maxDepth = 8;
  const stack = [{ dir: PACKAGED_AGX_CLOUD_ROOT, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (isStandaloneAppDir(dir)) {
      cachedPackagedAgxCloudDir = dir;
      return cachedPackagedAgxCloudDir;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === '.git') continue;
      stack.push({ dir: path.join(dir, e.name), depth: depth + 1 });
    }
  }

  cachedPackagedAgxCloudDir = null;
  return cachedPackagedAgxCloudDir;
}

function getTaskLogPath(taskName) {
  if (!fs.existsSync(TASK_LOGS_DIR)) {
    fs.mkdirSync(TASK_LOGS_DIR, { recursive: true });
  }
  return path.join(TASK_LOGS_DIR, `${taskName}.log`);
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isDaemonRunning() {
  try {
    if (!fs.existsSync(DAEMON_PID_FILE)) return false;
    const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf8').trim(), 10);
    if (!pid) return false;
    process.kill(pid, 0);
    return pid;
  } catch {
    return false;
  }
}

async function stopDaemonProcessTree(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;

  const killTree = (signal) => {
    try {
      process.kill(-pid, signal);
      return true;
    } catch (err) {
      if (err.code === 'ESRCH') return false;
      process.kill(pid, signal);
      return true;
    }
  };

  killTree('SIGTERM');
  while (isPidAlive(pid) && Date.now() < deadline) {
    await sleep(100);
  }

  if (!isPidAlive(pid)) return true;

  killTree('SIGKILL');
  await sleep(150);
  return !isPidAlive(pid);
}

function resolveEmbeddedWorkerProjectDir() {
  const override = process.env.AGX_CLOUD_WORKER_DIR;
  if (override && typeof override === 'string') {
    const resolved = path.resolve(override);
    try {
      if (fs.existsSync(path.join(resolved, 'package.json'))) return resolved;
    } catch { }
  }

  const hasFile = (dir, rel) => {
    try { return fs.existsSync(path.join(dir, rel)); } catch { return false; }
  };

  const scoreCandidate = (dir) => {
    if (!dir) return -Infinity;
    if (!hasFile(dir, 'package.json')) return -Infinity;

    const hasWorkerEntrypoint =
      hasFile(dir, path.join('worker', 'index.ts')) ||
      hasFile(dir, path.join('worker', 'index.js')) ||
      hasFile(dir, path.join('worker', 'index.mjs'));

    const hasTsx =
      hasFile(dir, path.join('node_modules', '.bin', 'tsx')) ||
      hasFile(dir, path.join('node_modules', 'tsx', 'dist', 'cli.mjs'));

    let score = 0;
    if (hasWorkerEntrypoint) score += 10;
    if (hasTsx) score += 3;
    if (path.resolve(dir) === path.resolve(LOCAL_AGX_CLOUD_DIR)) score += 5;
    if (path.resolve(dir) === path.resolve(PACKAGED_AGX_CLOUD_DIR) && !hasWorkerEntrypoint) score -= 5;
    return score;
  };

  const CWD_AGX_CLOUD_DIR = path.resolve(process.cwd(), '..', 'agx-cloud');

  const packaged = resolvePackagedAgxCloudDir();
  const candidates = [CWD_AGX_CLOUD_DIR, LOCAL_AGX_CLOUD_DIR, packaged, PACKAGED_AGX_CLOUD_DIR].filter(Boolean);
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const s = scoreCandidate(candidate);
    if (s > bestScore) {
      bestScore = s;
      best = candidate;
    }
  }

  if (!best || bestScore < 1) return null;
  return best;
}

function isTemporalWorkerRunning() {
  const readPid = (pidFile) => {
    try {
      if (!fs.existsSync(pidFile)) return null;
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (!pid) return null;
      process.kill(pid, 0);
      return pid;
    } catch {
      return null;
    }
  };

  return readPid(WORKER_PID_FILE) || false;
}

function pickEmbeddedWorkerNpmScript(projectDir) {
  try {
    const pkgPath = path.join(projectDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const scripts = pkg?.scripts || {};
    if (scripts['daemon:worker']) return 'daemon:worker';
    if (scripts.worker) return 'worker';
  } catch { }
  return 'worker';
}

function loadEnvFile(envPath) {
  try {
    if (!envPath || !fs.existsSync(envPath)) return {};
    const raw = fs.readFileSync(envPath, 'utf8');
    const env = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!key) continue;
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

function loadBoardEnv() {
  return loadEnvFile(path.join(CONFIG_DIR, 'board.env'));
}

function isBoardRunning() {
  try {
    if (!fs.existsSync(BOARD_PID_FILE)) return false;
    const pid = parseInt(fs.readFileSync(BOARD_PID_FILE, 'utf8').trim(), 10);
    if (!pid) return false;
    process.kill(pid, 0);
    return pid;
  } catch {
    return false;
  }
}

function resolveBoardDir() {
  const override = process.env.AGX_CLOUD_WORKER_DIR;
  if (override && typeof override === 'string') {
    const resolved = path.resolve(override);
    try {
      if (fs.existsSync(path.join(resolved, 'package.json'))) return { dir: resolved, mode: 'dev' };
    } catch { }
  }

  const hasFile = (dir, rel) => {
    try { return fs.existsSync(path.join(dir, rel)); } catch { return false; }
  };

  const CWD_AGX_CLOUD_DIR = path.resolve(process.cwd(), '..', 'agx-cloud');
  for (const dir of [CWD_AGX_CLOUD_DIR, LOCAL_AGX_CLOUD_DIR]) {
    if (hasFile(dir, 'package.json')) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        if (pkg?.scripts?.dev) return { dir, mode: 'dev' };
      } catch { }
    }
  }

  const packaged = resolvePackagedAgxCloudDir();
  if (packaged && hasFile(packaged, 'server.js')) {
    return { dir: packaged, mode: 'bundled' };
  }

  return null;
}

function getBoardPort() {
  const apiUrl = process.env.AGX_CLOUD_URL || process.env.AGX_BOARD_URL || 'http://localhost:41741';
  try {
    const u = new URL(apiUrl);
    return parseInt(u.port, 10) || (u.protocol === 'https:' ? 443 : 80);
  } catch {
    return 41741;
  }
}

async function probeBoardHealth(port, timeoutMs = 1500) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://localhost:${port}/api/tasks`, {
      signal: controller.signal,
      headers: { 'x-user-id': '' },
    });
    clearTimeout(timer);
    return res.ok || res.status === 401;
  } catch {
    return false;
  }
}

const DOCKER_POSTGRES_CONTAINER = 'agx-postgres';
const DOCKER_DEFAULT_DB_URL = 'postgresql://agx:agx@localhost:55432/agx';

function isDockerPostgresRunning() {
  try {
    const result = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', DOCKER_POSTGRES_CONTAINER], { timeout: 3000 });
    return result.stdout && result.stdout.toString().trim() === 'true';
  } catch {
    return false;
  }
}

function dockerExecPsql({ sql, timeoutMs = 60000 }) {
  return spawnSync('docker', [
    'exec', '-i', DOCKER_POSTGRES_CONTAINER,
    'psql', '-U', 'agx', '-d', 'agx',
  ], { input: sql, timeout: timeoutMs });
}

function dockerHasRelation(qualifiedName) {
  const safe = String(qualifiedName).replace(/'/g, "''");
  const res = dockerExecPsql({ sql: `select to_regclass('${safe}') as rel;\\n`, timeoutMs: 10000 });
  if (res.status !== 0) return false;
  const out = (res.stdout || Buffer.from('')).toString('utf8');
  return out.includes(qualifiedName.split('.').pop()) && !out.includes('null');
}

function ensureDockerSchemaInitialized() {
  if (!isDockerPostgresRunning()) return;
  const needsProjects = !dockerHasRelation('public.projects') || !dockerHasRelation('public.project_repos');
  if (!needsProjects) return;

  const initSqlPath = path.join(__dirname, 'templates', 'stack', 'postgres', 'init', '001_agx_board_schema.sql');
  if (!fs.existsSync(initSqlPath)) return;

  console.log(`${c.dim}Initializing database schema...${c.reset}`);
  const initSql = fs.readFileSync(initSqlPath, 'utf8');
  const psqlResult = dockerExecPsql({ sql: initSql, timeoutMs: 60000 });
  if (psqlResult.status !== 0) {
    const stderr = (psqlResult.stderr || Buffer.from('')).toString('utf8').trim();
    console.log(`${c.yellow}Schema init returned non-zero${c.reset}${stderr ? `: ${stderr}` : ''}`);
  }
}

function ensureSchemaInitialized(dbUrl) {
  const initSqlPath = path.join(__dirname, 'templates', 'stack', 'postgres', 'init', '001_agx_board_schema.sql');
  if (!fs.existsSync(initSqlPath)) return;

  const initSql = fs.readFileSync(initSqlPath, 'utf8');

  if (dbUrl === DOCKER_DEFAULT_DB_URL) {
    if (!isDockerPostgresRunning()) return;
    console.log(`${c.dim}Initializing database schema...${c.reset}`);
    const psqlResult = dockerExecPsql({ sql: initSql, timeoutMs: 60000 });
    if (psqlResult.status !== 0) {
      const stderr = (psqlResult.stderr || Buffer.from('')).toString('utf8').trim();
      console.log(`${c.yellow}Schema init returned non-zero${c.reset}${stderr ? `: ${stderr}` : ''}`);
    }
    return;
  }

  console.log(`${c.dim}Initializing database schema...${c.reset}`);
  const psqlResult = spawnSync('psql', [dbUrl], { input: initSql, timeout: 60000 });
  if (psqlResult.status !== 0) {
    const stderr = (psqlResult.stderr || Buffer.from('')).toString('utf8').trim();
    console.log(`${c.yellow}Schema init returned non-zero${c.reset}${stderr ? `: ${stderr}` : ''}`);
  }
}

async function ensurePostgresReady() {
  const boardEnv = loadBoardEnv();
  if (boardEnv.DATABASE_URL) {
    try {
      const dbUrl = new URL(boardEnv.DATABASE_URL);
      const host = dbUrl.hostname;
      const port = dbUrl.port || '5432';
      const result = spawnSync('pg_isready', ['-h', host, '-p', port], { timeout: 3000 });
      if (result.status === 0) {
        ensureSchemaInitialized(boardEnv.DATABASE_URL);
        return boardEnv.DATABASE_URL;
      }
    } catch { }
  }

  if (isDockerPostgresRunning()) {
    const dbUrl = DOCKER_DEFAULT_DB_URL;
    saveBoardEnvValue('DATABASE_URL', dbUrl);
    ensureSchemaInitialized(dbUrl);
    return dbUrl;
  }

  console.log(`\\n${c.yellow}Postgres is required for the agx board server.${c.reset}`);
  console.log(`  ${c.bold}1${c.reset}) Enter a custom DATABASE_URL`);
  console.log(`  ${c.bold}2${c.reset}) Auto-start postgres via Docker`);

  const answer = await prompt(`\\n${c.cyan}Choice [2]:${c.reset} `);
  const choice = answer.trim() || '2';

  if (choice === '1') {
    const dbUrl = await prompt(`${c.cyan}DATABASE_URL:${c.reset} `);
    if (!dbUrl) {
      console.error(`${c.red}No DATABASE_URL provided.${c.reset}`);
      process.exit(1);
    }
    saveBoardEnvValue('DATABASE_URL', dbUrl);
    return dbUrl;
  }

  console.log(`${c.dim}Starting postgres via Docker...${c.reset}`);
  const dockerResult = spawnSync('docker', [
    'run', '-d',
    '--name', 'agx-postgres',
    '-e', 'POSTGRES_DB=agx',
    '-e', 'POSTGRES_USER=agx',
    '-e', 'POSTGRES_PASSWORD=agx',
    '-p', '55432:5432',
    '-v', 'agx_pg_data:/var/lib/postgresql/data',
    'postgres:16-alpine',
  ], { stdio: 'pipe', timeout: 60000 });

  if (dockerResult.status !== 0) {
    const stderr = dockerResult.stderr ? dockerResult.stderr.toString() : '';
    if (stderr.includes('already in use')) {
      spawnSync('docker', ['start', 'agx-postgres'], { timeout: 10000 });
    } else {
      console.error(`${c.red}Failed to start postgres:${c.reset} ${stderr}`);
      process.exit(1);
    }
  }

  console.log(`${c.dim}Waiting for postgres to be ready...${c.reset}`);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const check = spawnSync('docker', ['exec', 'agx-postgres', 'pg_isready', '-U', 'agx'], { timeout: 3000 });
    if (check.status === 0) break;
    await sleep(1000);
  }

  const dbUrl = DOCKER_DEFAULT_DB_URL;
  saveBoardEnvValue('DATABASE_URL', dbUrl);
  ensureSchemaInitialized(dbUrl);

  console.log(`${c.green}✓${c.reset} Postgres ready`);
  return dbUrl;
}

function saveBoardEnvValue(key, value) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = loadBoardEnv();
  existing[key] = value;
  const content = Object.entries(existing).map(([k, v]) => `${k}=${v}`).join('\\n') + '\\n';
  fs.writeFileSync(BOARD_ENV_FILE, content);
}

let _boardEnsured = false;
async function ensureBoardRunning() {
  if (_boardEnsured) return;
  _boardEnsured = true;

  const apiUrl = process.env.AGX_CLOUD_URL || process.env.AGX_BOARD_URL || 'http://localhost:41741';
  try {
    const u = new URL(apiUrl);
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1' && u.hostname !== '0.0.0.0' && u.hostname !== '::1') return;
  } catch { return; }

  const port = getBoardPort();
  if (await probeBoardHealth(port)) return;

  const existingPid = isBoardRunning();
  if (existingPid && await probeBoardHealth(port)) return;

  if (existingPid) {
    try { fs.unlinkSync(BOARD_PID_FILE); } catch { }
  }

  console.log(`${c.dim}Board server not reachable at localhost:${port}, starting...${c.reset}`);
  const dbUrl = await ensurePostgresReady();
  ensureDockerSchemaInitialized();

  const boardInfo = resolveBoardDir();
  if (!boardInfo) {
    console.error(`${c.red}Board runtime not found.${c.reset} Ensure agx-cloud is at ${LOCAL_AGX_CLOUD_DIR} or build standalone runtime.`);
    console.log(`${c.dim}Tip: set AGX_CLOUD_WORKER_DIR=/path/to/agx-cloud${c.reset}`);
    _boardEnsured = false;
    return;
  }

  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });

  let logFd;
  try {
    logFd = fs.openSync(BOARD_LOG_FILE, 'a');
  } catch (err) {
    console.error(`${c.red}Unable to open board log:${c.reset} ${err.message}`);
    _boardEnsured = false;
    return;
  }

  const boardEnv = {
    ...process.env,
    DATABASE_URL: dbUrl,
    PORT: String(port),
    AGX_BOARD_DISABLE_AUTH: '1',
  };

  saveBoardEnvValue('DATABASE_URL', dbUrl);
  saveBoardEnvValue('PORT', String(port));

  let proc;
  try {
    if (boardInfo.mode === 'bundled') {
      proc = spawn('node', ['server.js'], {
        cwd: boardInfo.dir,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: boardEnv,
      });
    } else {
      proc = spawn('npm', ['run', 'dev'], {
        cwd: boardInfo.dir,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: boardEnv,
      });
    }
  } catch (err) {
    fs.closeSync(logFd);
    console.error(`${c.red}Failed to start board server:${c.reset} ${err.message}`);
    _boardEnsured = false;
    return;
  }

  fs.closeSync(logFd);
  proc.unref();
  fs.writeFileSync(BOARD_PID_FILE, String(proc.pid));

  console.log(`${c.dim}Waiting for board server (pid ${proc.pid})...${c.reset}`);
  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    if (await probeBoardHealth(port)) {
      ready = true;
      break;
    }
    await sleep(500);
  }

  if (ready) {
    console.log(`${c.green}✓${c.reset} Board server started (pid ${proc.pid}, port ${port})`);
    console.log(`${c.dim}  Logs: ${BOARD_LOG_FILE}${c.reset}`);
  } else {
    console.log(`${c.yellow}Board server started but not yet responding — check ${BOARD_LOG_FILE}${c.reset}`);
  }
}

async function stopBoard() {
  const pid = isBoardRunning();
  if (!pid) {
    console.log(`${c.yellow}Board server not running${c.reset}`);
    return false;
  }

  try {
    const stopped = await stopDaemonProcessTree(pid);
    if (fs.existsSync(BOARD_PID_FILE)) fs.unlinkSync(BOARD_PID_FILE);

    if (!stopped) {
      console.error(`${c.red}Failed to stop board server:${c.reset} pid ${pid} still running`);
      return false;
    }

    console.log(`${c.green}✓${c.reset} Board server stopped (pid ${pid})`);
    return true;
  } catch (err) {
    console.error(`${c.red}Failed to stop board server:${c.reset} ${err.message}`);
    return false;
  }
}

function startTemporalWorker() {
  const existingPid = isTemporalWorkerRunning();
  if (existingPid) {
    console.log(`${c.dim}Orchestrator worker already running (pid ${existingPid})${c.reset}`);
    return existingPid;
  }

  const projectDir = resolveEmbeddedWorkerProjectDir();
  if (!projectDir) {
    console.log(
      `${c.yellow}Local board runtime not found.${c.reset} ` +
      `AGX couldn't locate an agx-cloud checkout/runtime for the embedded worker.\\n` +
      `${c.dim}Looked for:${c.reset} ../agx-cloud (from current directory), ${LOCAL_AGX_CLOUD_DIR}, ${PACKAGED_AGX_CLOUD_DIR}\\n` +
      `${c.dim}Fix:${c.reset} set AGX_CLOUD_WORKER_DIR=/path/to/agx-cloud, then run: (cd "$AGX_CLOUD_WORKER_DIR" && npm install && npm run build)`
    );
    return null;
  }

  const workerEntrypoints = [
    path.join(projectDir, 'worker', 'index.ts'),
    path.join(projectDir, 'worker', 'index.js'),
    path.join(projectDir, 'worker', 'index.mjs'),
  ];
  if (!workerEntrypoints.some((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  })) {
    console.log(`${c.red}Orchestrator worker entrypoint not found in:${c.reset} ${projectDir}`);
    console.log(`${c.dim}Expected one of:${c.reset} ${workerEntrypoints.join(', ')}`);
    console.log(`${c.dim}Tip:${c.reset} set AGX_CLOUD_WORKER_DIR=/path/to/agx-cloud`);
    return null;
  }

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  let logFd;
  try {
    logFd = fs.openSync(WORKER_LOG_FILE, 'a');
  } catch (err) {
    console.error(`${c.red}Unable to open orchestrator worker log:${c.reset} ${err.message}`);
    return null;
  }

  const script = pickEmbeddedWorkerNpmScript(projectDir);
  let worker;
  try {
    const boardEnv = loadBoardEnv();
    if (!boardEnv.DATABASE_URL) {
      console.log(`${c.yellow}Orchestrator worker not started${c.reset} (missing DATABASE_URL).`);
      console.log(`${c.dim}Start the board first so ~/.agx/board.env is populated:${c.reset} agx board start`);
      fs.closeSync(logFd);
      return null;
    }
    worker = spawn('npm', ['run', script], {
      cwd: projectDir,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, ...boardEnv },
    });
  } catch (err) {
    fs.closeSync(logFd);
    console.error(`${c.red}Failed to start orchestrator worker:${c.reset} ${err.message}`);
    return null;
  }

  fs.closeSync(logFd);
  worker.unref();
  fs.writeFileSync(WORKER_PID_FILE, String(worker.pid));

  console.log(`${c.green}✓${c.reset} Orchestrator worker started (pid ${worker.pid})`);
  console.log(`${c.dim}  Logs: ${WORKER_LOG_FILE}${c.reset}`);
  return worker.pid;
}

async function ensureTemporalWorkerRunning() {
  try {
    const boardEnv = loadBoardEnv();
    if (!boardEnv.DATABASE_URL) {
      await ensureBoardRunning();
    }
  } catch { }
  return startTemporalWorker();
}

async function stopTemporalWorker() {
  const pid = isTemporalWorkerRunning();
  if (!pid) {
    console.log(`${c.yellow}Orchestrator worker not running${c.reset}`);
    return false;
  }

  try {
    const stopped = await stopDaemonProcessTree(pid);
    if (!stopped) {
      console.error(`${c.red}Failed to stop orchestrator worker process tree:${c.reset} pid ${pid} is still running`);
      return false;
    }

    if (fs.existsSync(WORKER_PID_FILE)) fs.unlinkSync(WORKER_PID_FILE);

    console.log(`${c.green}✓${c.reset} Orchestrator worker stopped (pid ${pid})`);
    return true;
  } catch (err) {
    console.error(`${c.red}Failed to stop orchestrator worker:${c.reset} ${err.message}`);
    return false;
  }
}

function startDaemon(options = {}) {
  const existingPid = isDaemonRunning();
  if (existingPid) {
    console.log(`${c.dim}Daemon already running (pid ${existingPid})${c.reset}`);
    return existingPid;
  }

  const agxDir = path.dirname(DAEMON_PID_FILE);
  if (!fs.existsSync(agxDir)) {
    fs.mkdirSync(agxDir, { recursive: true });
  }

  const agxPath = process.argv[1];
  const daemonArgs = [agxPath, 'daemon', 'run'];
  if (options.maxWorkers && Number.isFinite(options.maxWorkers) && options.maxWorkers > 0) {
    daemonArgs.push('--workers', String(options.maxWorkers));
  }

  const daemon = spawn(process.execPath, daemonArgs, {
    detached: true,
    stdio: ['ignore',
      fs.openSync(DAEMON_LOG_FILE, 'a'),
      fs.openSync(DAEMON_LOG_FILE, 'a')
    ],
    env: {
      ...process.env,
      AGX_DAEMON: '1',
      ...(options.maxWorkers ? { AGX_DAEMON_MAX_CONCURRENT: String(options.maxWorkers) } : {}),
    }
  });

  daemon.unref();
  fs.writeFileSync(DAEMON_PID_FILE, String(daemon.pid));

  console.log(`${c.green}✓${c.reset} Daemon started (pid ${daemon.pid})`);
  console.log(`${c.dim}  Logs: ${DAEMON_LOG_FILE}${c.reset}`);
  console.log(`${c.dim}  Execution workers: ${options.maxWorkers || 1}${c.reset}`);
  console.log(`${c.dim}  Configure workers: agx daemon start -w 4${c.reset}`);
  console.log(`${c.dim}  Run in foreground: agx daemon${c.reset}`);

  void ensureTemporalWorkerRunning();

  return daemon.pid;
}

async function stopDaemon() {
  const pid = isDaemonRunning();
  let daemonStopped = false;

  if (!pid) {
    console.log(`${c.yellow}Daemon not running${c.reset}`);
  } else {
    try {
      const stopped = await stopDaemonProcessTree(pid);
      if (fs.existsSync(DAEMON_PID_FILE)) {
        fs.unlinkSync(DAEMON_PID_FILE);
      }
      if (!stopped) {
        console.error(`${c.red}Failed to stop daemon process tree:${c.reset} pid ${pid} is still running`);
      } else {
        console.log(`${c.green}✓${c.reset} Daemon stopped (pid ${pid})`);
        daemonStopped = true;
      }
    } catch (err) {
      console.error(`${c.red}Failed to stop daemon:${c.reset} ${err.message}`);
    }
  }

  const temporalStopped = await stopTemporalWorker();
  const boardStopped = await stopBoard();
  return daemonStopped || temporalStopped || boardStopped;
}

module.exports = {
  // Paths/constants that other CLI pieces display.
  DAEMON_PID_FILE,
  DAEMON_LOG_FILE,
  DAEMON_STATE_FILE,
  BOARD_PID_FILE,
  BOARD_LOG_FILE,
  BOARD_ENV_FILE,
  WORKER_PID_FILE,
  WORKER_LOG_FILE,

  // Helpers
  getTaskLogPath,
  isDaemonRunning,
  isBoardRunning,
  stopDaemonProcessTree,
  ensureBoardRunning,
  stopBoard,
  ensureTemporalWorkerRunning,
  stopTemporalWorker,
  startDaemon,
  stopDaemon,
  resolveBoardDir,
  resolvePackagedAgxCloudDir,
};
