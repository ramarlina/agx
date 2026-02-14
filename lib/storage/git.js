const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXEC_OPTIONS = { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 };
const MAX_CHANGED_FILES = 20;

function runGitCommand(args, cwd, overrideOptions = {}) {
    const command = ['git', ...args].join(' ');
    try {
        return execSync(command, { ...EXEC_OPTIONS, cwd, ...overrideOptions });
    } catch (err) {
        const message = `${command} failed${err.message ? `: ${err.message}` : ''}`;
        const wrapped = new Error(message);
        wrapped.cause = err;
        throw wrapped;
    }
}

function parseChangedFiles(statusOutput) {
    if (!statusOutput) return [];
    const seen = new Set();
    const result = [];
    const lines = statusOutput.split(/\r?\n/);
    for (const rawLine of lines) {
        if (!rawLine) continue;
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.length < 4) continue;
        let filePath = trimmed.slice(3).trim();
        const arrowIndex = filePath.indexOf('->');
        if (arrowIndex >= 0) {
            filePath = filePath.slice(arrowIndex + 2).trim();
        }
        if (!filePath || seen.has(filePath)) continue;
        seen.add(filePath);
        result.push(filePath);
        if (result.length >= MAX_CHANGED_FILES) break;
    }
    return result;
}

function captureGitState(cwd) {
    if (!cwd) {
        throw new Error('captureGitState requires a working directory');
    }

    const statusOutput = runGitCommand(['status', '--porcelain'], cwd);
    const trimmedStatus = statusOutput.trim();

    const state = {
        sha: runGitCommand(['rev-parse', 'HEAD'], cwd).trim(),
        branch: null,
        dirty: trimmedStatus.length > 0,
        patch: null,
        changedFiles: parseChangedFiles(statusOutput),
    };

    const branchName = runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();
    state.branch = branchName === 'HEAD' ? null : branchName;

    if (state.dirty) {
        const diff = runGitCommand(['diff', 'HEAD'], cwd);
        state.patch = diff ? diff : null;
    }

    return state;
}

function resolvePatchFile(patchFile, cwd) {
    if (!patchFile || typeof patchFile !== 'string') {
        return null;
    }

    const candidates = [];
    candidates.push(patchFile);
    if (!path.isAbsolute(patchFile)) {
        candidates.push(path.resolve(cwd, patchFile));
        if (cwd !== process.cwd()) {
            candidates.push(path.resolve(process.cwd(), patchFile));
        }
    }

    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        } catch {
            // ignore
        }
    }

    return null;
}

function readPatch(patchFilePath) {
    if (!patchFilePath) return null;
    try {
        const contents = fs.readFileSync(patchFilePath, 'utf8');
        return contents.trim() ? contents : null;
    } catch (err) {
        throw new Error(`Unable to read patch file ${patchFilePath}: ${err.message}`);
    }
}

function restoreGitState(gitState, cwd, opts = {}) {
    if (!cwd) {
        throw new Error('restoreGitState requires a working directory');
    }

    if (!gitState || typeof gitState !== 'object') {
        throw new Error('restoreGitState requires a git state object');
    }

    const { sha, patchFile, patch: inlinePatch } = gitState;
    if (!sha || typeof sha !== 'string') {
        throw new Error('restoreGitState requires a saved git sha');
    }

    const statusOutput = runGitCommand(['status', '--porcelain'], cwd);
    const hasDirty = Boolean(statusOutput.trim());
    if (hasDirty && !opts.force) {
        throw new Error('Working tree has uncommitted changes; pass { force: true } to override');
    }

    runGitCommand(['reset', '--hard'], cwd);

    if (opts.force) {
        runGitCommand(['clean', '-fd'], cwd);
    }

    runGitCommand(['checkout', sha], cwd);

    const resolvedPatchFile = resolvePatchFile(patchFile, cwd);
    const resolvedPatch = resolvedPatchFile ? readPatch(resolvedPatchFile) : null;
    const inlineContent = typeof inlinePatch === 'string' && inlinePatch.trim() ? inlinePatch : null;
    const patchToApply = resolvedPatch || inlineContent;

    if (patchToApply) {
        runGitCommand(['apply', '--3way'], cwd, { input: patchToApply });
    }
}

module.exports = {
    captureGitState,
    restoreGitState,
};
