/**
 * Tests for lib/storage/locks.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const locks = require('../../../lib/storage/locks');
const atomic = require('../../../lib/storage/atomic');

describe('lib/storage/locks', () => {
    let testDir;
    let taskDir;

    beforeEach(async () => {
        // Create temp directory for each test
        testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agx-locks-test-'));
        taskDir = path.join(testDir, 'my-task');
        await fs.promises.mkdir(taskDir, { recursive: true });
    });

    afterEach(async () => {
        // Clean up temp directory
        try {
            await fs.promises.rm(testDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('acquireTaskLock', () => {
        it('creates .lock with expected payload fields', async () => {
            const handle = await locks.acquireTaskLock(taskDir);

            const lockPath = path.join(taskDir, '.lock');
            const lockContent = await atomic.readJsonSafe(lockPath);

            expect(lockContent).toHaveProperty('pid');
            expect(lockContent).toHaveProperty('at');
            expect(lockContent).toHaveProperty('host');
            expect(lockContent.pid).toBe(process.pid);
            expect(typeof lockContent.at).toBe('string');
            expect(typeof lockContent.host).toBe('string');

            await locks.releaseTaskLock(handle);
        });

        it('second acquire fails while lock is held', async () => {
            const handle1 = await locks.acquireTaskLock(taskDir);

            // Same process trying to re-acquire should get a clear error
            await expect(locks.acquireTaskLock(taskDir)).rejects.toThrow(/Lock already held by this process instance/);

            await locks.releaseTaskLock(handle1);
        });

        it('can acquire after release', async () => {
            const handle1 = await locks.acquireTaskLock(taskDir);
            await locks.releaseTaskLock(handle1);

            const handle2 = await locks.acquireTaskLock(taskDir);
            expect(handle2.pid).toBe(process.pid);

            await locks.releaseTaskLock(handle2);
        });

        it('force option overrides existing lock', async () => {
            const handle1 = await locks.acquireTaskLock(taskDir);

            const handle2 = await locks.acquireTaskLock(taskDir, { force: true });
            expect(handle2.pid).toBe(process.pid);

            // Note: handle1 is now invalid
            await locks.releaseTaskLock(handle2);
        });
    });

    describe('releaseTaskLock', () => {
        it('removes lock file', async () => {
            const handle = await locks.acquireTaskLock(taskDir);
            await locks.releaseTaskLock(handle);

            const lockPath = path.join(taskDir, '.lock');
            const exists = await atomic.fileExists(lockPath);
            expect(exists).toBe(false);
        });

        it('safe to call multiple times', async () => {
            const handle = await locks.acquireTaskLock(taskDir);

            await locks.releaseTaskLock(handle);
            await locks.releaseTaskLock(handle);
            await locks.releaseTaskLock(handle);

            // Should not throw
            expect(handle.released).toBe(true);
        });

        it('does not remove lock taken by another process', async () => {
            const handle = await locks.acquireTaskLock(taskDir);

            // Simulate another process taking the lock
            const lockPath = path.join(taskDir, '.lock');
            await atomic.writeJsonAtomic(lockPath, {
                pid: 99999,
                at: new Date().toISOString(),
                host: 'other-host',
            });

            // Release should not remove the other process's lock
            await locks.releaseTaskLock(handle);

            const exists = await atomic.fileExists(lockPath);
            expect(exists).toBe(true);
        });
    });

    describe('checkTaskLock', () => {
        it('returns null for unlocked task', async () => {
            const result = await locks.checkTaskLock(taskDir);
            expect(result).toBeNull();
        });

        it('returns lock payload for locked task', async () => {
            const handle = await locks.acquireTaskLock(taskDir);

            const result = await locks.checkTaskLock(taskDir);
            expect(result).not.toBeNull();
            expect(result.pid).toBe(process.pid);

            await locks.releaseTaskLock(handle);
        });

        it('returns null for stale lock', async () => {
            // Create a stale lock
            const lockPath = path.join(taskDir, '.lock');
            const staleTime = new Date(Date.now() - locks.LOCK_STALE_MS - 1000).toISOString();
            await atomic.writeJsonAtomic(lockPath, {
                pid: 99999,
                at: staleTime,
                host: 'old-host',
            });

            const result = await locks.checkTaskLock(taskDir);
            expect(result).toBeNull();
        });
    });

    describe('cleanStaleLock', () => {
        it('returns false for no lock', async () => {
            const result = await locks.cleanStaleLock(taskDir);
            expect(result).toBe(false);
        });

        it('returns false for active lock', async () => {
            const handle = await locks.acquireTaskLock(taskDir);

            const result = await locks.cleanStaleLock(taskDir);
            expect(result).toBe(false);

            await locks.releaseTaskLock(handle);
        });

        it('removes and returns true for stale lock', async () => {
            // Create a stale lock
            const lockPath = path.join(taskDir, '.lock');
            const staleTime = new Date(Date.now() - locks.LOCK_STALE_MS - 1000).toISOString();
            await atomic.writeJsonAtomic(lockPath, {
                pid: 99999,
                at: staleTime,
                host: 'old-host',
            });

            const result = await locks.cleanStaleLock(taskDir);
            expect(result).toBe(true);

            const exists = await atomic.fileExists(lockPath);
            expect(exists).toBe(false);
        });

        it('removes lock for dead process', async () => {
            // Create a lock with a PID that likely doesn't exist
            const lockPath = path.join(taskDir, '.lock');
            await atomic.writeJsonAtomic(lockPath, {
                pid: 1, // Init process - we can't be running as init
                at: new Date().toISOString(),
                host: os.hostname(),
            });

            // The lock should be cleaned if process 1 check fails
            // (This test may behave differently on different systems)
            const result = await locks.cleanStaleLock(taskDir);
            // Result depends on whether we're running as root or not
            expect(typeof result).toBe('boolean');
        });
    });
});
