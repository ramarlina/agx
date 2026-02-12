'use strict';

const fs = require('fs');
const path = require('path');
const { getDescendants } = require('./killProcessTree');

const CONFIG_DIR = path.join(require('os').homedir(), '.agx');
const HEARTBEAT_DIR = path.join(CONFIG_DIR, 'heartbeat');

class ProcessManager {
  /** @type {Map<number, {proc: import('child_process').ChildProcess, label: string, spawnedAt: number, timeout: number|null, timeoutTimer: NodeJS.Timeout|null, lastActivity: number}>} */
  #processes = new Map();
  #heartbeatInterval = null;
  #cleanupInstalled = false;

  constructor() {
    this.#ensureHeartbeatDir();
    this.#installCleanupHooks();
    this.#startHeartbeatMonitor();
  }

  #ensureHeartbeatDir() {
    try {
      if (!fs.existsSync(HEARTBEAT_DIR)) {
        fs.mkdirSync(HEARTBEAT_DIR, { recursive: true });
      }
    } catch { }
  }

  /**
   * Register a spawned child process for tracking.
   * @param {import('child_process').ChildProcess} proc
   * @param {object} opts
   * @param {string} [opts.label]
   * @param {number} [opts.timeoutMs] - Hard timeout; kills process after this many ms.
   * @param {boolean} [opts.heartbeat=true] - Enable activity-based heartbeat monitoring.
   * @returns {import('child_process').ChildProcess}
   */
  register(proc, opts = {}) {
    const pid = proc.pid;
    if (!pid) return proc;

    const timeoutMs = opts.timeoutMs ?? (process.env.AGX_TASK_TIMEOUT_MS ? Number(process.env.AGX_TASK_TIMEOUT_MS) : null);
    const now = Date.now();

    const entry = {
      proc,
      label: opts.label || `pid-${pid}`,
      spawnedAt: now,
      lastActivity: now,
      timeout: timeoutMs,
      timeoutTimer: null,
      heartbeat: opts.heartbeat !== false,
    };

    // Hard timeout
    if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      entry.timeoutTimer = setTimeout(() => {
        if (this.#processes.has(pid)) {
          this.kill(pid);
        }
      }, timeoutMs);
      entry.timeoutTimer.unref();
    }

    this.#processes.set(pid, entry);

    // Auto-remove on exit
    proc.on('exit', () => {
      this.#cleanup(pid);
    });
    proc.on('error', () => {
      this.#cleanup(pid);
    });

    return proc;
  }

  /**
   * Record activity for a tracked process (extends heartbeat).
   */
  recordActivity(pid) {
    const entry = this.#processes.get(pid);
    if (entry) {
      entry.lastActivity = Date.now();
    }
  }

  /**
   * Kill a tracked process and its entire tree.
   */
  kill(pid, { signal = 'SIGTERM', graceMs = 2000 } = {}) {
    const descendants = getDescendants(pid);
    // Kill bottom-up (leaves first)
    for (let i = descendants.length - 1; i >= 0; i--) {
      try { process.kill(descendants[i], signal); } catch { }
    }
    try { process.kill(pid, signal); } catch { }

    // Schedule SIGKILL escalation
    if (signal !== 'SIGKILL') {
      const timer = setTimeout(() => {
        for (let i = descendants.length - 1; i >= 0; i--) {
          try { process.kill(descendants[i], 'SIGKILL'); } catch { }
        }
        try { process.kill(pid, 'SIGKILL'); } catch { }
      }, graceMs);
      timer.unref();
    }

    this.#cleanup(pid);
  }

  /**
   * Kill all tracked processes.
   */
  killAll() {
    for (const pid of [...this.#processes.keys()]) {
      this.kill(pid);
    }
  }

  #cleanup(pid) {
    const entry = this.#processes.get(pid);
    if (!entry) return;
    if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
    this.#processes.delete(pid);
    // Clean heartbeat file
    try { fs.unlinkSync(path.join(HEARTBEAT_DIR, String(pid))); } catch { }
  }

  #startHeartbeatMonitor() {
    const STALE_THRESHOLD_MS = Number(process.env.AGX_STALE_THRESHOLD_MS) || 600_000; // 10 minutes default
    const CHECK_INTERVAL_MS = Number(process.env.AGX_CHECK_INTERVAL_MS) || 60_000;    // 1 minute

    this.#heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [pid, entry] of this.#processes) {
        if (!entry.heartbeat) continue;
        if (now - entry.lastActivity > STALE_THRESHOLD_MS) {
          console.error(`[ProcessManager] Process ${pid} (${entry.label}) stale for >${Math.round((now - entry.lastActivity) / 1000)}s — killing`);
          this.kill(pid);
        }
      }
    }, CHECK_INTERVAL_MS);
    this.#heartbeatInterval.unref();
  }

  #installCleanupHooks() {
    if (this.#cleanupInstalled) return;
    this.#cleanupInstalled = true;

    const cleanup = () => {
      if (this.#heartbeatInterval) {
        clearInterval(this.#heartbeatInterval);
        this.#heartbeatInterval = null;
      }
      this.killAll();
    };

    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(130); });
    process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  }

  /**
   * Sweep orphaned heartbeat files whose PIDs no longer exist.
   */
  sweepOrphanedHeartbeats() {
    try {
      const files = fs.readdirSync(HEARTBEAT_DIR);
      for (const file of files) {
        const pid = parseInt(file, 10);
        if (!Number.isFinite(pid)) continue;
        try {
          process.kill(pid, 0);
        } catch {
          // Process doesn't exist, clean up
          try { fs.unlinkSync(path.join(HEARTBEAT_DIR, file)); } catch { }
        }
      }
    } catch { }
  }

  get tracked() {
    return this.#processes.size;
  }
}

// Singleton
let _instance;
function getProcessManager() {
  if (!_instance) _instance = new ProcessManager();
  return _instance;
}

module.exports = { ProcessManager, getProcessManager };
