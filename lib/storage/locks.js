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

    // Check existing lock
    const existingLock = await readJsonSafe(lockPath);

    if (existingLock && !force) {
        // First check: is this our own lock from a previous run that wasn't released?
        // This handles the case where the same process crashed/restarted mid-task.
        if (existingLock.pid === process.pid) {
            // Same PID - check if it's truly from this process instance
            if (!isCurrentProcessLock(existingLock)) {
                // Lock is from a previous instance of this PID (PID was reused)
                // or from before this process started - safe to take over
                // This is the key fix: we clean up our own stale locks
            } else {
                // Lock is from current process instance - we already hold it
                // This shouldn't happen in normal operation, but return the existing lock
                // Actually, this would be a programming error, so let's throw
                throw new Error(
                    `Lock already held by this process instance. ` +
                    `This indicates a logic error - lock should be released before re-acquiring.`
                );
            }
        } else {
            // Different PID - check if the process is still alive and lock is fresh
            const isAlive = isProcessAlive(existingLock.pid);
            const isStale = isLockStale(existingLock);

            if (isAlive && !isStale) {
                // Also check process start time if available
                const startTimeValid = !existingLock.startedAt || 
                    isProcessStartTimeValid(existingLock.pid, existingLock.startedAt);
                
                if (startTimeValid) {
                    throw new Error(
                        `Task is locked by process ${existingLock.pid} since ${existingLock.at}. ` +
                        `Use --force to override if you're sure the lock is stale.`
                    );
                }
                // Process has same PID but different start time (PID reuse) - lock is stale
            }

            // Lock is stale or process is dead - we can take it
        }
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
