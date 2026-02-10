'use strict';

const { execSync, spawnSync } = require('child_process');

function isPidAlive(pid) {
  if (!pid || typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all descendant PIDs of a process using `ps -o pid=,ppid= -ax`.
 * Returns descendants in bottom-up order (leaves first).
 */
function getDescendants(rootPid) {
  if (process.platform === 'win32') return [];
  try {
    const output = execSync('ps -o pid=,ppid= -ax', { encoding: 'utf8', timeout: 3000 });
    const children = new Map();
    for (const line of output.trim().split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(pid);
    }

    // BFS to collect all descendants, then reverse for bottom-up order
    const result = [];
    const queue = [rootPid];
    while (queue.length) {
      const parent = queue.shift();
      const kids = children.get(parent);
      if (!kids) continue;
      for (const kid of kids) {
        if (kid !== rootPid) {
          result.push(kid);
          queue.push(kid);
        }
      }
    }
    return result.reverse(); // leaves first
  } catch {
    return [];
  }
}

function tryKillPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    if (err && err.code === 'ESRCH') return false;
    return false;
  }
}

function tryKillUnixProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (err) {
    if (err && err.code === 'ESRCH') return false;
    return false;
  }
}

function tryTaskkillWindows(pid, force) {
  try {
    const args = ['/pid', String(pid), '/T'];
    if (force) args.push('/F');
    const res = spawnSync('taskkill', args, { stdio: 'ignore', timeout: 3000 });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Kill the entire process tree rooted at `pid`.
 * Uses ps-based descendant enumeration for reliable tree killing,
 * with process group kill as fallback.
 */
function tryKillTree(pid, signal) {
  if (!pid) return false;

  if (process.platform === 'win32') {
    return tryTaskkillWindows(pid, signal === 'SIGKILL' || signal === 'SIGTERM');
  }

  // Enumerate descendants and kill bottom-up (leaves first)
  const descendants = getDescendants(pid);
  let killed = false;

  for (const desc of descendants) {
    if (tryKillPid(desc, signal)) killed = true;
  }

  // Kill root — try group first, then individual
  if (tryKillUnixProcessGroup(pid, signal)) {
    killed = true;
  } else if (tryKillPid(pid, signal)) {
    killed = true;
  }

  return killed;
}

function scheduleTermination(pid, { graceMs = 800, forceMs = 2500 } = {}) {
  if (!pid) return { cancel: () => { } };

  if (isPidAlive(pid)) {
    tryKillTree(pid, 'SIGTERM');
  }

  let killTimer = null;
  let forceTimer = null;

  killTimer = setTimeout(() => {
    if (!isPidAlive(pid)) return;
    tryKillTree(pid, 'SIGKILL');
  }, Math.max(0, graceMs));

  forceTimer = setTimeout(() => {
    if (!isPidAlive(pid)) return;
    tryKillTree(pid, 'SIGKILL');
  }, Math.max(0, forceMs));

  try { killTimer.unref(); } catch { }
  try { forceTimer.unref(); } catch { }

  return {
    cancel: () => {
      if (killTimer) clearTimeout(killTimer);
      if (forceTimer) clearTimeout(forceTimer);
      killTimer = null;
      forceTimer = null;
    }
  };
}

module.exports = {
  isPidAlive,
  tryKillTree,
  scheduleTermination,
  getDescendants,
};
