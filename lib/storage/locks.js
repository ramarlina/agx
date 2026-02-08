/**
 * Task-level file locking for agx local state storage.
 * 
 * Prevents concurrent execution of the same task.
 * Lock file contains: { pid, at, host }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { writeJsonAtomic, readJsonSafe, fileExists } = require('./atomic');

// ============================================================
// Constants
// ============================================================

const LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes - consider lock stale if older

// ============================================================
// Lock Management
// ============================================================

/**
 * @typedef {object} LockHandle
 * @property {string} lockPath - Path to the lock file
 * @property {number} pid - Process ID that holds the lock
 * @property {string} at - ISO timestamp when lock was acquired
 * @property {boolean} released - Whether the lock has been released
 */

/**
 * @typedef {object} LockPayload
 * @property {number} pid
 * @property {string} at
 * @property {string} host
 */

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
        // Check if the process is still alive
        const isAlive = isProcessAlive(existingLock.pid);
        const isStale = isLockStale(existingLock);

        if (isAlive && !isStale) {
            throw new Error(
                `Task is locked by process ${existingLock.pid} since ${existingLock.at}. ` +
                `Use --force to override if you're sure the lock is stale.`
            );
        }

        // Lock is stale or process is dead - we can take it
    }

    const now = new Date().toISOString();
    const pid = process.pid;

    /** @type {LockPayload} */
    const payload = {
        pid,
        at: now,
        host: os.hostname(),
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

    try {
        // Verify we still own the lock before removing
        const current = await readJsonSafe(handle.lockPath);

        if (current && current.pid === handle.pid && current.at === handle.at) {
            await fs.promises.unlink(handle.lockPath);
        }
        // If someone else took the lock, don't remove it

    } catch (err) {
        if (err.code !== 'ENOENT') {
            // Log but don't throw - lock release is best-effort
            console.error(`Warning: Failed to release lock ${handle.lockPath}:`, err.message);
        }
    }

    handle.released = true;
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

    // Check if still valid
    const isAlive = isProcessAlive(lock.pid);
    const isStale = isLockStale(lock);

    if (!isAlive || isStale) {
        return null; // Lock is stale
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

    const isAlive = isProcessAlive(lock.pid);
    const isStale = isLockStale(lock);

    if (!isAlive || isStale) {
        try {
            await fs.promises.unlink(lockPath);
            return true;
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
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

// ============================================================
// Exports
// ============================================================

module.exports = {
    LOCK_STALE_MS,
    acquireTaskLock,
    releaseTaskLock,
    checkTaskLock,
    cleanStaleLock,
};
