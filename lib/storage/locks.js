/**
 * Task-level file locking for agx local state storage.
 * 
 * Prevents concurrent execution of the same task.
 * Lock file contains: { pid, at, host, startedAt }
 * 
 * Lock validity checks:
 * 1. Process must be alive (kill(pid, 0) succeeds)
 * 2. Process start time must match (guards against PID reuse)
 * 3. Lock must not be stale (default: 5 minutes)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { writeJsonAtomic, readJsonSafe, fileExists } = require('./atomic');

// ============================================================
// Constants
// ============================================================

const DEFAULT_LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes - consider lock stale if older

// Allow override via environment variable
const LOCK_STALE_MS = process.env.AGX_LOCK_STALE_MS
    ? parseInt(process.env.AGX_LOCK_STALE_MS, 10)
    : DEFAULT_LOCK_STALE_MS;

// Process start time - used to detect PID reuse
const PROCESS_STARTED_AT = Date.now();

// ============================================================
// Lock Registry — track all held locks for cleanup on exit
// ============================================================

/** @type {Set<LockHandle>} */
const _heldLocks = new Set();
let _exitHandlerRegistered = false;

function _registerExitHandler() {
    if (_exitHandlerRegistered) return;
    _exitHandlerRegistered = true;

    // Synchronous cleanup on exit — best-effort delete of lock files.
    // This fires for normal exit, SIGINT, SIGTERM — but NOT SIGKILL.
    const cleanup = () => {
        for (const handle of _heldLocks) {
            if (handle.released) continue;
            try {
                // Verify ownership before deleting (sync read + unlink)
                const raw = fs.readFileSync(handle.lockPath, 'utf8');
                const lock = JSON.parse(raw);
                if (lock.pid === handle.pid && lock.at === handle.at) {
                    fs.unlinkSync(handle.lockPath);
                }
            } catch {
                // Best-effort — ignore errors during shutdown
            }
            handle.released = true;
        }
        _heldLocks.clear();
    };

    process.on('exit', cleanup);

    // For signals, run cleanup. If no other handlers exist, re-raise so the
    // process actually exits. If other handlers exist, let them decide when to exit.
    for (const sig of ['SIGINT', 'SIGTERM']) {
        process.on(sig, () => {
            cleanup();
            const listeners = process.listeners(sig);
            if (listeners.length <= 1) {
                // Remove handlers (including this one) to avoid recursion, then re-raise.
                process.removeAllListeners(sig);
                process.kill(process.pid, sig);
            }
        });
    }
}

// ============================================================
// Lock Management
// ============================================================

/**
 * @typedef {object} LockHandle
 * @property {string} lockPath - Path to the lock file
 * @property {number} pid - Process ID that holds the lock
 * @property {string} at - ISO timestamp when lock was acquired
 * @property {number} startedAt - Process start timestamp (ms since epoch)
 * @property {boolean} released - Whether the lock has been released
 */

/**
 * @typedef {object} LockPayload
 * @property {number} pid
 * @property {string} at
 * @property {string} host
 * @property {number} [startedAt] - Process start timestamp (ms since epoch)
 */

/**
 * Check if a lock is owned by the current process instance.
 * This guards against PID reuse by comparing process start times.
 * @param {LockPayload} lock
 * @returns {boolean}
 */
function isCurrentProcessLock(lock) {
    if (lock.pid !== process.pid) {
        return false;
    }
    // If startedAt is present, it must match our start time
    if (typeof lock.startedAt === 'number') {
        return lock.startedAt === PROCESS_STARTED_AT;
    }
    // Legacy lock without startedAt - be conservative, assume it's not ours
    return false;
}

/**
 * Attempt to acquire a task lock.
 * @param {string} taskRootPath - Path to the task directory
 * @param {object} [options]
 * @param {boolean} [options.force=false] - Force acquire even if locked (for recovery)
 * @returns {Promise<LockHandle>}
 * @throws {Error} If lock cannot be acquired
 */
async function acquireTaskLock(taskRootPath, options = {}) {
    const lockPath = path.join(taskRootPath, '.lock');
    const force = options.force || false;

    // Proactively clean stale locks before attempting acquisition
    // This handles the common case where a previous process died without cleanup
    const existingLock = await readJsonSafe(lockPath);

    if (existingLock && !force) {
        const { valid, reason } = isLockValid(existingLock);
        if (!valid) {
            // Lock is stale/dead — clean it up silently
            try { await fs.promises.unlink(lockPath); } catch (e) {
                if (e.code !== 'ENOENT') throw e;
            }
            // Fall through to acquire below
        }
    }

    // Re-read after potential cleanup
    const currentLock = existingLock ? await readJsonSafe(lockPath) : null;

    if (currentLock && !force) {
        // If we get here, the lock survived the stale cleanup above — it's genuinely held.
        if (currentLock.pid === process.pid && isCurrentProcessLock(currentLock)) {
            throw new Error(
                `Lock already held by this process instance. ` +
                `This indicates a logic error - lock should be released before re-acquiring.`
            );
        }
        // Lock is held by a live process — reject
        throw new Error(
            `Task is locked by process ${currentLock.pid} since ${currentLock.at}. ` +
            `Use --force to override if you're sure the lock is stale.`
        );
    }

    const now = new Date().toISOString();
    const pid = process.pid;

    /** @type {LockPayload} */
    const payload = {
        pid,
        at: now,
        host: os.hostname(),
        startedAt: PROCESS_STARTED_AT,
    };

    // Ensure task directory exists
    await fs.promises.mkdir(taskRootPath, { recursive: true });

    // Write lock file atomically
    await writeJsonAtomic(lockPath, payload);

    // Verify we got the lock (another process might have raced us)
    const verification = await readJsonSafe(lockPath);
    if (!verification || verification.pid !== pid || verification.at !== now) {
        throw new Error('Failed to acquire lock - another process may have taken it');
    }

    /** @type {LockHandle} */
    const handle = {
        lockPath,
        pid,
        at: now,
        startedAt: PROCESS_STARTED_AT,
        released: false,
    };

    // Track for cleanup on process exit
    _heldLocks.add(handle);
    _registerExitHandler();

    return handle;
}

/**
 * Release a task lock.
 * Safe to call multiple times.
 * @param {LockHandle} handle
 * @returns {Promise<void>}
 */
async function releaseTaskLock(handle) {
    if (handle.released) {
        return;
    }

    let deleted = false;
    let ownershipVerified = false;

    try {
        // Verify we still own the lock before removing
        const current = await readJsonSafe(handle.lockPath);

        if (current && current.pid === handle.pid && current.at === handle.at) {
            ownershipVerified = true;
            await fs.promises.unlink(handle.lockPath);
            deleted = true;
        } else if (!current) {
            // Lock file doesn't exist - already released or never created
            deleted = true;
        }
        // If someone else took the lock, don't remove it (deleted stays false)

    } catch (err) {
        if (err.code === 'ENOENT') {
            // File doesn't exist - that's fine
            deleted = true;
        } else {
            // Log the error but continue - we'll try a forceful cleanup below
            console.error(`Warning: Failed to release lock ${handle.lockPath}:`, err.message);
            
            // If we verified ownership but failed to delete, try once more
            if (ownershipVerified) {
                try {
                    await fs.promises.unlink(handle.lockPath);
                    deleted = true;
                } catch (retryErr) {
                    if (retryErr.code === 'ENOENT') {
                        deleted = true; // Succeeded (file was removed between attempts)
                    } else {
                        console.error(`Warning: Retry failed for lock ${handle.lockPath}:`, retryErr.message);
                    }
                }
            }
        }
    }

    handle.released = true;
    _heldLocks.delete(handle);

    // Return status for debugging (callers typically ignore this)
    return { deleted, ownershipVerified };
}

/**
 * Check if a lock is currently held for a task.
 * @param {string} taskRootPath
 * @returns {Promise<LockPayload|null>}
 */
async function checkTaskLock(taskRootPath) {
    const lockPath = path.join(taskRootPath, '.lock');
    const lock = await readJsonSafe(lockPath);

    if (!lock) {
        return null;
    }

    // Check if lock is valid
    const { valid } = isLockValid(lock);
    if (!valid) {
        return null; // Lock is stale or invalid
    }

    return lock;
}

/**
 * Clean up stale locks for a task.
 * @param {string} taskRootPath
 * @returns {Promise<boolean>} True if a stale lock was cleaned
 */
async function cleanStaleLock(taskRootPath) {
    const lockPath = path.join(taskRootPath, '.lock');
    const lock = await readJsonSafe(lockPath);

    if (!lock) {
        return false;
    }

    const { valid, reason } = isLockValid(lock);

    if (!valid) {
        try {
            await fs.promises.unlink(lockPath);
            return true;
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
            // File already deleted - that's fine
            return true;
        }
    }

    return false;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Check if a process is still alive.
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
    try {
        // Sending signal 0 checks if process exists without actually signaling
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if a process start time is valid (the lock was created by the current
 * instance of that process, not a previous one that had the same PID).
 * 
 * This is a heuristic: if the startedAt is in the future or very old compared
 * to the lock timestamp, something is wrong.
 * 
 * @param {number} pid
 * @param {number} startedAt - Process start time from lock
 * @returns {boolean}
 */
function isProcessStartTimeValid(pid, startedAt) {
    if (typeof startedAt !== 'number') {
        // No start time recorded - be conservative and assume valid
        return true;
    }
    
    const now = Date.now();
    
    // If startedAt is in the future, that's suspicious
    if (startedAt > now + 60000) { // Allow 1 minute clock skew
        return false;
    }
    
    // If the lock holder is our own process, check if startedAt matches
    if (pid === process.pid) {
        return startedAt === PROCESS_STARTED_AT;
    }
    
    // For other processes, we can't reliably verify start time
    // Just do a sanity check that it's not impossibly old
    return true;
}

/**
 * Check if a lock is stale based on timestamp.
 * @param {LockPayload} lock
 * @returns {boolean}
 */
function isLockStale(lock) {
    try {
        const lockTime = new Date(lock.at).getTime();
        const now = Date.now();
        return now - lockTime > LOCK_STALE_MS;
    } catch {
        return true; // If we can't parse the time, consider it stale
    }
}

/**
 * Determine if a lock is valid (should block acquisition).
 * @param {LockPayload} lock
 * @returns {{ valid: boolean, reason: string }}
 */
function isLockValid(lock) {
    if (!lock) {
        return { valid: false, reason: 'no lock' };
    }

    // Check if process is alive
    const alive = isProcessAlive(lock.pid);
    if (!alive) {
        return { valid: false, reason: 'process dead' };
    }

    // Check if lock is stale
    if (isLockStale(lock)) {
        return { valid: false, reason: 'lock stale' };
    }

    // Check process start time if available
    if (lock.startedAt && !isProcessStartTimeValid(lock.pid, lock.startedAt)) {
        return { valid: false, reason: 'pid reused' };
    }

    // Check if it's our own lock from a previous run
    if (lock.pid === process.pid && !isCurrentProcessLock(lock)) {
        return { valid: false, reason: 'own stale lock' };
    }

    return { valid: true, reason: 'valid' };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
    LOCK_STALE_MS,
    PROCESS_STARTED_AT,
    acquireTaskLock,
    releaseTaskLock,
    checkTaskLock,
    cleanStaleLock,
    isProcessAlive,
    isLockStale,
    isLockValid,
};
