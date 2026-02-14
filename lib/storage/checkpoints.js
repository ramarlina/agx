/**
 * Checkpoint durability helpers for agx task state.
 *
 * Stores checkpoint metadata in checkpoints.json and git patches in patches/*.diff.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { projectRoot, validateSlug } = require('./paths');
const { ensureDir, fileExists, writeJsonAtomic, writeFileAtomic, readJsonSafe } = require('./atomic');

const MAX_HISTORY = 50;
const DEFAULT_CHECKPOINTS = { head: null, history: [] };
const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let generateUlid = null;
try {
    ({ ulid: generateUlid } = require('ulid'));
} catch {
    // Offline fallback keeps checkpoint creation functional if dependency install is unavailable.
    generateUlid = function fallbackUlid() {
        let time = Date.now();
        let timePart = '';
        for (let i = 0; i < 10; i += 1) {
            timePart = CROCKFORD_BASE32[time % 32] + timePart;
            time = Math.floor(time / 32);
        }

        let randomPart = '';
        const randomBytes = crypto.randomBytes(16);
        for (let i = 0; i < randomBytes.length; i += 1) {
            randomPart += CROCKFORD_BASE32[randomBytes[i] & 31];
        }

        return `${timePart}${randomPart}`;
    };
}

function checkpointsTaskRoot(projectSlug, taskSlug) {
    const projectValidation = validateSlug(projectSlug);
    if (!projectValidation.valid) {
        throw new Error(`Invalid project slug: ${projectValidation.error} (got ${typeof projectSlug}: ${JSON.stringify(projectSlug)})`);
    }
    const taskValidation = validateSlug(taskSlug);
    if (!taskValidation.valid) {
        throw new Error(`Invalid task slug: ${taskValidation.error} (got ${typeof taskSlug}: ${JSON.stringify(taskSlug)})`);
    }

    return path.join(projectRoot(projectSlug), 'tasks', taskSlug);
}

function checkpointsPath(projectSlug, taskSlug) {
    return path.join(checkpointsTaskRoot(projectSlug, taskSlug), 'checkpoints.json');
}

function normalizeCheckpointsData(data) {
    if (!data || typeof data !== 'object') {
        return null;
    }

    const history = Array.isArray(data.history)
        ? data.history.filter(entry => entry && typeof entry === 'object')
        : [];
    const head = typeof data.head === 'string' ? data.head : null;

    return { head, history };
}

async function tryReadCheckpoints(filePath) {
    try {
        const data = await readJsonSafe(filePath);
        if (!data) {
            return null;
        }
        return normalizeCheckpointsData(data);
    } catch {
        return null;
    }
}

async function writeCheckpointsFile(projectSlug, taskSlug, data) {
    const mainPath = checkpointsPath(projectSlug, taskSlug);
    const backupPath = `${mainPath}.bak`;
    const normalized = normalizeCheckpointsData(data) || DEFAULT_CHECKPOINTS;

    await ensureDir(path.dirname(mainPath));

    if (await fileExists(mainPath)) {
        try {
            await fs.promises.unlink(backupPath);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }

        await fs.promises.rename(mainPath, backupPath);
    }

    try {
        await writeJsonAtomic(mainPath, normalized);
    } catch (err) {
        if (!(await fileExists(mainPath)) && (await fileExists(backupPath))) {
            try {
                await fs.promises.rename(backupPath, mainPath);
            } catch {
                // If restoration fails, keep original write error.
            }
        }
        throw err;
    }

    return normalized;
}

async function readCheckpointsFile(projectSlug, taskSlug) {
    const mainPath = checkpointsPath(projectSlug, taskSlug);
    const backupPath = `${mainPath}.bak`;

    const mainData = await tryReadCheckpoints(mainPath);
    if (mainData) {
        return mainData;
    }

    const backupData = await tryReadCheckpoints(backupPath);
    if (backupData) {
        return backupData;
    }

    return { ...DEFAULT_CHECKPOINTS };
}

function patchesDirPath(projectSlug, taskSlug) {
    return path.join(checkpointsTaskRoot(projectSlug, taskSlug), 'patches');
}

function patchFileRelativePath(checkpointId) {
    return `patches/${checkpointId}.diff`;
}

async function createCheckpoint(projectSlug, taskSlug, data = {}) {
    const current = await readCheckpointsFile(projectSlug, taskSlug);

    const id = `cp_${generateUlid()}`;
    const createdAt = new Date().toISOString();

    const inputGit = data && typeof data.git === 'object' && data.git !== null
        ? data.git
        : {};
    const gitPatch = typeof inputGit.patch === 'string' ? inputGit.patch : null;
    let patchFile = null;

    if (gitPatch !== null) {
        patchFile = patchFileRelativePath(id);
        const patchDir = patchesDirPath(projectSlug, taskSlug);
        await ensureDir(patchDir);
        await writeFileAtomic(path.join(checkpointsTaskRoot(projectSlug, taskSlug), patchFile), gitPatch);
    }

    const git = {
        ...inputGit,
    };
    if (patchFile) {
        git.patchFile = patchFile;
    }
    delete git.patch;

    const checkpoint = {
        ...data,
        id,
        createdAt,
        git,
    };

    const history = [checkpoint, ...current.history].slice(0, MAX_HISTORY);
    const next = {
        head: id,
        history,
    };

    await writeCheckpointsFile(projectSlug, taskSlug, next);
    return checkpoint;
}

async function getHead(projectSlug, taskSlug) {
    const data = await readCheckpointsFile(projectSlug, taskSlug);
    if (!data.head) {
        return null;
    }
    return data.history.find(cp => cp && cp.id === data.head) || null;
}

module.exports = {
    MAX_HISTORY,
    checkpointsPath,
    writeCheckpointsFile,
    readCheckpointsFile,
    createCheckpoint,
    getHead,
};
