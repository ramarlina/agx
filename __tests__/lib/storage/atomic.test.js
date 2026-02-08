/**
 * Tests for lib/storage/atomic.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const atomic = require('../../../lib/storage/atomic');

describe('lib/storage/atomic', () => {
    let testDir;

    beforeEach(async () => {
        // Create temp directory for each test
        testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agx-atomic-test-'));
    });

    afterEach(async () => {
        // Clean up temp directory
        try {
            await fs.promises.rm(testDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('writeJsonAtomic', () => {
        it('writes valid JSON', async () => {
            const filePath = path.join(testDir, 'test.json');
            const data = { foo: 'bar', count: 42 };

            await atomic.writeJsonAtomic(filePath, data);

            const content = await fs.promises.readFile(filePath, 'utf8');
            const parsed = JSON.parse(content);
            expect(parsed).toEqual(data);
        });

        it('does not leave *.tmp on success', async () => {
            const filePath = path.join(testDir, 'test.json');
            await atomic.writeJsonAtomic(filePath, { test: true });

            const files = await fs.promises.readdir(testDir);
            const tmpFiles = files.filter(f => f.includes('.tmp'));
            expect(tmpFiles).toHaveLength(0);
        });

        it('overwrites existing file atomically', async () => {
            const filePath = path.join(testDir, 'test.json');

            await atomic.writeJsonAtomic(filePath, { version: 1 });
            await atomic.writeJsonAtomic(filePath, { version: 2 });

            const content = await fs.promises.readFile(filePath, 'utf8');
            const parsed = JSON.parse(content);
            expect(parsed.version).toBe(2);
        });

        it('creates parent directories if needed', async () => {
            const filePath = path.join(testDir, 'nested', 'deep', 'test.json');

            await atomic.writeJsonAtomic(filePath, { nested: true });

            const exists = await atomic.fileExists(filePath);
            expect(exists).toBe(true);
        });

        it('uses specified indentation', async () => {
            const filePath = path.join(testDir, 'test.json');
            await atomic.writeJsonAtomic(filePath, { a: 1 }, { indent: 4 });

            const content = await fs.promises.readFile(filePath, 'utf8');
            expect(content).toContain('    '); // 4 spaces
        });
    });

    describe('writeFileAtomic', () => {
        it('writes string content', async () => {
            const filePath = path.join(testDir, 'test.txt');
            await atomic.writeFileAtomic(filePath, 'hello world');

            const content = await fs.promises.readFile(filePath, 'utf8');
            expect(content).toBe('hello world');
        });

        it('writes buffer content', async () => {
            const filePath = path.join(testDir, 'test.bin');
            const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);

            await atomic.writeFileAtomic(filePath, buffer);

            const content = await fs.promises.readFile(filePath);
            expect(content).toEqual(buffer);
        });
    });

    describe('readJsonSafe', () => {
        it('returns parsed JSON for existing file', async () => {
            const filePath = path.join(testDir, 'test.json');
            await fs.promises.writeFile(filePath, '{"test": true}');

            const result = await atomic.readJsonSafe(filePath);
            expect(result).toEqual({ test: true });
        });

        it('returns null for non-existent file', async () => {
            const filePath = path.join(testDir, 'nonexistent.json');

            const result = await atomic.readJsonSafe(filePath);
            expect(result).toBeNull();
        });

        it('throws for invalid JSON', async () => {
            const filePath = path.join(testDir, 'invalid.json');
            await fs.promises.writeFile(filePath, 'not valid json');

            await expect(atomic.readJsonSafe(filePath)).rejects.toThrow();
        });
    });

    describe('readTextSafe', () => {
        it('returns content for existing file', async () => {
            const filePath = path.join(testDir, 'test.txt');
            await fs.promises.writeFile(filePath, 'hello');

            const result = await atomic.readTextSafe(filePath);
            expect(result).toBe('hello');
        });

        it('returns null for non-existent file', async () => {
            const filePath = path.join(testDir, 'nonexistent.txt');

            const result = await atomic.readTextSafe(filePath);
            expect(result).toBeNull();
        });
    });

    describe('appendFile', () => {
        it('appends to existing file', async () => {
            const filePath = path.join(testDir, 'test.txt');
            await fs.promises.writeFile(filePath, 'line1\n');

            await atomic.appendFile(filePath, 'line2\n');

            const content = await fs.promises.readFile(filePath, 'utf8');
            expect(content).toBe('line1\nline2\n');
        });

        it('creates file if it does not exist', async () => {
            const filePath = path.join(testDir, 'new.txt');

            await atomic.appendFile(filePath, 'content');

            const content = await fs.promises.readFile(filePath, 'utf8');
            expect(content).toBe('content');
        });

        it('creates parent directories if needed', async () => {
            const filePath = path.join(testDir, 'nested', 'new.txt');

            await atomic.appendFile(filePath, 'content');

            const exists = await atomic.fileExists(filePath);
            expect(exists).toBe(true);
        });
    });

    describe('fileExists', () => {
        it('returns true for existing file', async () => {
            const filePath = path.join(testDir, 'test.txt');
            await fs.promises.writeFile(filePath, 'content');

            const exists = await atomic.fileExists(filePath);
            expect(exists).toBe(true);
        });

        it('returns false for non-existent file', async () => {
            const filePath = path.join(testDir, 'nonexistent.txt');

            const exists = await atomic.fileExists(filePath);
            expect(exists).toBe(false);
        });
    });

    describe('ensureDir', () => {
        it('creates directory if it does not exist', async () => {
            const dirPath = path.join(testDir, 'new-dir');

            await atomic.ensureDir(dirPath);

            const stat = await fs.promises.stat(dirPath);
            expect(stat.isDirectory()).toBe(true);
        });

        it('creates nested directories', async () => {
            const dirPath = path.join(testDir, 'a', 'b', 'c');

            await atomic.ensureDir(dirPath);

            const stat = await fs.promises.stat(dirPath);
            expect(stat.isDirectory()).toBe(true);
        });

        it('is idempotent for existing directory', async () => {
            const dirPath = path.join(testDir, 'existing');
            await fs.promises.mkdir(dirPath);

            // Should not throw
            await atomic.ensureDir(dirPath);

            const stat = await fs.promises.stat(dirPath);
            expect(stat.isDirectory()).toBe(true);
        });
    });
});
