/**
 * Atomic file write utilities for agx local state storage.
 * 
 * Strategy:
 *   1. Write to *.tmp file
 *   2. fsync the file
 *   3. Rename to target (atomic on same filesystem)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================
// Atomic Write
// ============================================================

/**
 * Write data to a file atomically.
 * Creates parent directories if needed.
 * @param {string} filePath - Target file path
 * @param {string|Buffer} data - Content to write
 * @returns {Promise<void>}
 */
async function writeFileAtomic(filePath, data) {
    const dir = path.dirname(filePath);
    const tmpSuffix = `.tmp.${crypto.randomBytes(4).toString('hex')}`;
    const tmpPath = `${filePath}${tmpSuffix}`;

    // Ensure directory exists
    await fs.promises.mkdir(dir, { recursive: true });

    let fd = null;
    try {
        // Write to temp file
        fd = await fs.promises.open(tmpPath, 'w');
        await fd.writeFile(data);
        // Sync to disk
        await fd.sync();
        await fd.close();
        fd = null;

        // Atomic rename
        await fs.promises.rename(tmpPath, filePath);
    } catch (err) {
        // Cleanup on error
        if (fd) {
            try { await fd.close(); } catch { /* ignore */ }
        }
        try { await fs.promises.unlink(tmpPath); } catch { /* ignore */ }
        throw err;
    }
}

/**
 * Write JSON data to a file atomically.
 * @param {string} filePath - Target file path
 * @param {any} obj - Object to serialize and write
 * @param {object} [options]
 * @param {number} [options.indent=2] - JSON indentation
 * @returns {Promise<void>}
 */
async function writeJsonAtomic(filePath, obj, options = {}) {
    const indent = options.indent ?? 2;
    const json = JSON.stringify(obj, null, indent) + '\n';
    await writeFileAtomic(filePath, json);
}

/**
 * Read a JSON file, returning null if it doesn't exist.
 * @param {string} filePath
 * @returns {Promise<any|null>}
 */
async function readJsonSafe(filePath) {
    try {
        const content = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(content);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return null;
        }
        throw err;
    }
}

/**
 * Read a text file, returning null if it doesn't exist.
 * @param {string} filePath
 * @returns {Promise<string|null>}
 */
async function readTextSafe(filePath) {
    try {
        return await fs.promises.readFile(filePath, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') {
            return null;
        }
        throw err;
    }
}

/**
 * Append data to a file, creating it if it doesn't exist.
 * Creates parent directories if needed.
 * @param {string} filePath
 * @param {string|Buffer} data
 * @returns {Promise<void>}
 */
async function appendFile(filePath, data) {
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.appendFile(filePath, data);
}

/**
 * Check if a file exists.
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Ensure a directory exists.
 * @param {string} dirPath
 * @returns {Promise<void>}
 */
async function ensureDir(dirPath) {
    await fs.promises.mkdir(dirPath, { recursive: true });
}

// ============================================================
// Exports
// ============================================================

module.exports = {
    writeFileAtomic,
    writeJsonAtomic,
    readJsonSafe,
    readTextSafe,
    appendFile,
    fileExists,
    ensureDir,
};
