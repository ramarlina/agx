/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const execa = require('execa');

const { c } = require('../ui/colors');
const { CONFIG_DIR, DAEMON_PID_FILE, DAEMON_LOG_FILE, DAEMON_STATE_FILE, TASK_LOGS_DIR, BOARD_PID_FILE, BOARD_LOG_FILE, BOARD_ENV_FILE } = require('../config/paths');
const { getDescendants } = require('../proc/killProcessTree');
const { sleep } = require('./util');

// Bundled runtime roots (standalone build tracing preserves an absolute-path-like subtree).
const AGX_PKG_ROOT = path.resolve(__dirname, '..', '..');
const PACKAGED_AGX_CLOUD_ROOT = path.join(AGX_PKG_ROOT, 'cloud-runtime', 'standalone');
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
    // Kill descendants bottom-up (leaves first) via ps enumeration
    const descendants = getDescendants(pid);
    for (let i = descendants.length - 1; i >= 0; i--) {
      try { process.kill(descendants[i], signal); } catch { }
    }
    // Then kill root — try group first, fall back to individual
    try {
      process.kill(-pid, signal);
      return true;
    } catch (err) {
      if (err.code === 'ESRCH') return false;
      try {
        process.kill(pid, signal);
        return true;
      } catch { return false; }
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

function saveBoardEnvValue(key, value) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = loadBoardEnv();
  existing[key] = value;
  const content = Object.entries(existing).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(BOARD_ENV_FILE, content);
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
  const hasFile = (dir, rel) => {
    try { return fs.existsSync(path.join(dir, rel)); } catch { return false; }
  };

  const detectMode = (dir) => {
    if (hasFile(dir, 'server.js')) return 'bundled';
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg?.scripts?.dev) return 'dev';
    } catch { }
    return null;
  };

  const override = process.env.AGX_CLOUD_WORKER_DIR;
  if (override && typeof override === 'string') {
    const resolved = path.resolve(override);
    const mode = detectMode(resolved);
    if (mode) return { dir: resolved, mode };
  }

  const CWD_AGX_CLOUD_DIR = path.resolve(process.cwd(), '..', 'agx-cloud');
  for (const dir of [CWD_AGX_CLOUD_DIR, LOCAL_AGX_CLOUD_DIR]) {
    if (hasFile(dir, 'package.json')) {
      const mode = detectMode(dir);
      if (mode) return { dir, mode };
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

let _boardEnsured = false;
function resetBoardEnsured() {
  _boardEnsured = false;
}
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

  // Board runs on SQLite — pass AGX_DB_PATH for shared state
  const dbPath = process.env.AGX_DB_PATH || path.join(CONFIG_DIR, 'agx.db');
  const boardEnv = {
    ...process.env,
    AGX_DB_PATH: dbPath,
    PORT: String(port),
    AGX_BOARD_DISABLE_AUTH: '1',
  };

  saveBoardEnvValue('AGX_DB_PATH', dbPath);
  saveBoardEnvValue('PORT', String(port));

  let proc;
  try {
    if (boardInfo.mode === 'bundled') {
      proc = execa('node', ['server.js'], {
        cwd: boardInfo.dir,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: boardEnv,
        reject: false,
      });
    } else {
      proc = execa('npm', ['run', 'dev'], {
        cwd: boardInfo.dir,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: boardEnv,
        reject: false,
      });
    }
  } catch (err) {
    fs.closeSync(logFd);
    console.error(`${c.red}Failed to start board server:${c.reset} ${err.message}`);
    _boardEnsured = false;
    return;
  }

  fs.closeSync(logFd);
  proc.unref?.();
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

  const daemon = execa(process.execPath, daemonArgs, {
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

  daemon.unref?.();
  fs.writeFileSync(DAEMON_PID_FILE, String(daemon.pid));

  console.log(`${c.green}✓${c.reset} Daemon started (pid ${daemon.pid})`);
  console.log(`${c.dim}  Logs: ${DAEMON_LOG_FILE}${c.reset}`);
  console.log(`${c.dim}  Execution workers: ${options.maxWorkers || 1}${c.reset}`);
  console.log(`${c.dim}  Configure workers: agx daemon start -w 4${c.reset}`);
  console.log(`${c.dim}  Run in foreground: agx daemon${c.reset}`);

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

  const boardStopped = await stopBoard();
  return daemonStopped || boardStopped;
}

module.exports = {
  // Paths/constants that other CLI pieces display.
  DAEMON_PID_FILE,
  DAEMON_LOG_FILE,
  DAEMON_STATE_FILE,
  BOARD_PID_FILE,
  BOARD_LOG_FILE,
  BOARD_ENV_FILE,

  // Helpers
  getTaskLogPath,
  isDaemonRunning,
  isBoardRunning,
  stopDaemonProcessTree,
  ensureBoardRunning,
  stopBoard,
  startDaemon,
  stopDaemon,
  resolveBoardDir,
  resolvePackagedAgxCloudDir,

  // Board helpers used by daemonBoard command implementation.
  getBoardPort,
  probeBoardHealth,
  loadBoardEnv,
  resetBoardEnsured,
};
