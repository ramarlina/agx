'use strict';

const { spawnSync } = require('child_process');

function isPidAlive(pid) {
  if (!pid || typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tryKillUnixProcessGroup(pid, signal) {
  // Only works if the child was spawned as its own process group leader
  // (e.g. `spawn(..., { detached: true })`).
  try {
    process.kill(-pid, signal);
    return true;
  } catch (err) {
    if (err && err.code === 'ESRCH') return false;
    return false;
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

function tryTaskkillWindows(pid, force) {
  try {
    const args = ['/pid', String(pid), '/T'];
    if (force) args.push('/F');
    const res = spawnSync('taskkill', args, { stdio: 'ignore', timeout: 3000 });
    // taskkill returns non-zero if the process already died; treat as "not killed" but non-fatal.
    return res.status === 0;
  } catch {
    return false;
  }
}

function tryKillTree(pid, signal) {
  if (!pid) return false;

  if (process.platform === 'win32') {
    return tryTaskkillWindows(pid, signal === 'SIGKILL' || signal === 'SIGTERM');
  }

  // Prefer group kill when available; fall back to pid kill.
  if (tryKillUnixProcessGroup(pid, signal)) return true;
  return tryKillPid(pid, signal);
}

function scheduleTermination(pid, { graceMs = 800, forceMs = 2500 } = {}) {
  if (!pid) return { cancel: () => { } };

  // Best-effort: signal immediately, then escalate. If the process is already gone, do nothing.
  if (isPidAlive(pid)) {
    tryKillTree(pid, 'SIGTERM');
  }

  let killTimer = null;
  let forceTimer = null;

  killTimer = setTimeout(() => {
    if (!isPidAlive(pid)) return;
    tryKillTree(pid, 'SIGKILL');
  }, Math.max(0, graceMs));

  // Final fallback: sometimes SIGKILL races with respawn; try one last time.
  forceTimer = setTimeout(() => {
    if (!isPidAlive(pid)) return;
    tryKillTree(pid, 'SIGKILL');
  }, Math.max(0, forceMs));

  // Don't keep the parent alive just to finish escalation.
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
};

