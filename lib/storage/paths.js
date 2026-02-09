/**
 * Path construction and slug validation for agx local state storage.
 * 
 * Filesystem layout:
 *   ${AGX_HOME}/projects/<project_slug>/
 *     project.json
 *     index.json
 *     <task_slug>/
 *       task.json
 *       working_set.md
 *       approvals.json
 *       last_run.json
 *       <run_id>/
 *         plan/
 *         execute/
 *         verify/
 *         resume/
 *       .lock
 */

const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ============================================================
// Constants
// ============================================================

const VALID_STAGES = ['plan', 'execute', 'verify', 'resume'];
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Increase suffix entropy to avoid flakey collisions in tight loops.
// Note: validateRunId accepts legacy 4-hex ids as well.
const RUN_ID_RAND_BYTES = 4; // 8 hex chars

// ============================================================
// AGX Home
// ============================================================

/**
 * Get the AGX home directory.
 * Honors AGX_HOME env var, falls back to ~/.agx.
 * @returns {string}
 */
function getAgxHome() {
    return process.env.AGX_HOME || path.join(os.homedir(), '.agx');
}

// ============================================================
// Slug Validation and Generation
// ============================================================

/**
 * Validate a slug (project or task).
 * Must be kebab-case: lowercase letters, numbers, hyphens, no leading/trailing/consecutive hyphens.
 * @param {string} slug
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSlug(slug) {
    if (!slug || typeof slug !== 'string') {
        return { valid: false, error: 'Slug must be a non-empty string' };
    }
    if (slug.length > 128) {
        return { valid: false, error: 'Slug must be 128 characters or fewer' };
    }
    if (!SLUG_PATTERN.test(slug)) {
        return { valid: false, error: 'Slug must be kebab-case (lowercase letters, numbers, hyphens only, no leading/trailing/consecutive hyphens)' };
    }
    // Prevent path traversal attempts
    if (slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
        return { valid: false, error: 'Slug contains invalid path characters' };
    }
    return { valid: true };
}

/**
 * Convert arbitrary text to a valid slug.
 * Stable: same input always produces same output.
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.maxLength=64] - Maximum slug length
 * @returns {string}
 */
function slugify(text, options = {}) {
    const maxLength = options.maxLength || 64;

    if (!text || typeof text !== 'string') {
        return 'untitled';
    }

    let slug = text
        .toLowerCase()
        .trim()
        // Replace common separators with hyphens
        .replace(/[\s_]+/g, '-')
        // Remove non-alphanumeric except hyphens
        .replace(/[^a-z0-9-]/g, '')
        // Collapse consecutive hyphens
        .replace(/-+/g, '-')
        // Remove leading/trailing hyphens
        .replace(/^-+|-+$/g, '');

    if (!slug) {
        return 'untitled';
    }

    // Truncate to max length, avoiding cutting mid-word if possible
    if (slug.length > maxLength) {
        slug = slug.slice(0, maxLength);
        // Don't end with a hyphen
        slug = slug.replace(/-+$/, '');
    }

    return slug || 'untitled';
}

/**
 * Generate a unique slug from text, with collision avoidance suffix.
 * @param {string} text
 * @param {(candidate: string) => boolean} existsCheck - Returns true if slug already exists
 * @param {object} [options]
 * @param {number} [options.maxLength=64] - Maximum slug length (including suffix)
 * @returns {string}
 */
function slugifyUnique(text, existsCheck, options = {}) {
    const maxLength = options.maxLength || 64;
    const baseSlug = slugify(text, { maxLength: maxLength - 5 }); // Reserve space for -xxxx suffix

    if (!existsCheck(baseSlug)) {
        return baseSlug;
    }

    // Add random suffix
    const suffix = crypto.randomBytes(2).toString('hex');
    return `${baseSlug}-${suffix}`;
}

// ============================================================
// Run ID Generation
// ============================================================

/**
 * Generate a sortable, unique run ID.
 * Format: YYYYMMDD-HHMMSS-<rand4>
 * @returns {string}
 */
function generateRunId() {
    const now = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, '0');

    const datePart = [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
    ].join('');

    const timePart = [
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds()),
    ].join('');

    const randPart = crypto.randomBytes(RUN_ID_RAND_BYTES).toString('hex');

    return `${datePart}-${timePart}-${randPart}`;
}

/**
 * Validate a run ID format.
 * @param {string} runId
 * @returns {{ valid: boolean, error?: string }}
 */
function validateRunId(runId) {
    if (!runId || typeof runId !== 'string') {
        return { valid: false, error: 'Run ID must be a non-empty string' };
    }
    // Match YYYYMMDD-HHMMSS-<suffix> where suffix is legacy 4 hex chars or newer 8 hex chars.
    const pattern = /^\d{8}-\d{6}-[a-f0-9]{4}(?:[a-f0-9]{4})?$/;
    if (!pattern.test(runId)) {
        return { valid: false, error: 'Run ID must be in format YYYYMMDD-HHMMSS-<hex4|hex8>' };
    }
    return { valid: true };
}

/**
 * Validate a stage name.
 * @param {string} stage
 * @returns {{ valid: boolean, error?: string }}
 */
function validateStage(stage) {
    if (!VALID_STAGES.includes(stage)) {
        return { valid: false, error: `Stage must be one of: ${VALID_STAGES.join(', ')}` };
    }
    return { valid: true };
}

// ============================================================
// Path Construction
// ============================================================

/**
 * Get the projects root directory.
 * @returns {string}
 */
function projectsRoot() {
    return path.join(getAgxHome(), 'projects');
}

/**
 * Get the root directory for a project.
 * @param {string} projectSlug
 * @returns {string}
 * @throws {Error} If projectSlug is invalid
 */
function projectRoot(projectSlug) {
    const validation = validateSlug(projectSlug);
    if (!validation.valid) {
        throw new Error(`Invalid project slug: ${validation.error}`);
    }
    return path.join(projectsRoot(), projectSlug);
}

/**
 * Get the project.json path for a project.
 * @param {string} projectSlug
 * @returns {string}
 */
function projectJsonPath(projectSlug) {
    return path.join(projectRoot(projectSlug), 'project.json');
}

/**
 * Get the index.json path for a project.
 * @param {string} projectSlug
 * @returns {string}
 */
function projectIndexPath(projectSlug) {
    return path.join(projectRoot(projectSlug), 'index.json');
}

/**
 * Get the root directory for a task.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @returns {string}
 * @throws {Error} If projectSlug or taskSlug is invalid
 */
function taskRoot(projectSlug, taskSlug) {
    const projectValidation = validateSlug(projectSlug);
    if (!projectValidation.valid) {
        throw new Error(`Invalid project slug: ${projectValidation.error}`);
    }
    const taskValidation = validateSlug(taskSlug);
    if (!taskValidation.valid) {
        throw new Error(`Invalid task slug: ${taskValidation.error}`);
    }
    return path.join(projectRoot(projectSlug), taskSlug);
}

/**
 * Get the task.json path for a task.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @returns {string}
 */
function taskJsonPath(projectSlug, taskSlug) {
    return path.join(taskRoot(projectSlug, taskSlug), 'task.json');
}

/**
 * Get the working_set.md path for a task.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @returns {string}
 */
function workingSetPath(projectSlug, taskSlug) {
    return path.join(taskRoot(projectSlug, taskSlug), 'working_set.md');
}

/**
 * Get the approvals.json path for a task.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @returns {string}
 */
function approvalsPath(projectSlug, taskSlug) {
    return path.join(taskRoot(projectSlug, taskSlug), 'approvals.json');
}

/**
 * Get the last_run.json path for a task.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @returns {string}
 */
function lastRunPath(projectSlug, taskSlug) {
    return path.join(taskRoot(projectSlug, taskSlug), 'last_run.json');
}

/**
 * Get the .lock path for a task.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @returns {string}
 */
function taskLockPath(projectSlug, taskSlug) {
    return path.join(taskRoot(projectSlug, taskSlug), '.lock');
}

/**
 * Get the root directory for a specific run.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {string} stage - One of: plan, execute, verify, resume
 * @param {string} runId
 * @returns {string}
 * @throws {Error} If any parameter is invalid
 */
function runRoot(projectSlug, taskSlug, stage, runId) {
    const stageValidation = validateStage(stage);
    if (!stageValidation.valid) {
        throw new Error(stageValidation.error);
    }
    const runValidation = validateRunId(runId);
    if (!runValidation.valid) {
        throw new Error(`Invalid run ID: ${runValidation.error}`);
    }
    // New layout: group per run_id, with stage subfolders under the run container.
    //   <task_slug>/<run_id>/<stage>/
    return path.join(taskRoot(projectSlug, taskSlug), runId, stage);
}

/**
 * Legacy run root layout (pre-2026-02): <task_slug>/<stage>/<run_id>/
 * Kept for backward-compatible discovery/GC of old runs still on disk.
 */
function runRootLegacy(projectSlug, taskSlug, stage, runId) {
    const stageValidation = validateStage(stage);
    if (!stageValidation.valid) {
        throw new Error(stageValidation.error);
    }
    const runValidation = validateRunId(runId);
    if (!runValidation.valid) {
        throw new Error(`Invalid run ID: ${runValidation.error}`);
    }
    return path.join(taskRoot(projectSlug, taskSlug), stage, runId);
}

/**
 * Get paths for all files within a run directory.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {string} stage
 * @param {string} runId
 * @returns {object} Object with paths for meta.json, prompt.md, etc.
 */
function runPaths(projectSlug, taskSlug, stage, runId) {
    const root = runRoot(projectSlug, taskSlug, stage, runId);
    return {
        root,
        meta: path.join(root, 'meta.json'),
        prompt: path.join(root, 'prompt.md'),
        output: path.join(root, 'output.md'),
        decision: path.join(root, 'decision.json'),
        events: path.join(root, 'events.ndjson'),
        artifacts: path.join(root, 'artifacts'),
        logs: path.join(root, 'artifacts', 'logs.txt'),
        diff: path.join(root, 'artifacts', 'diff.patch'),
        contextSnippets: path.join(root, 'artifacts', 'context_snippets'),
        files: path.join(root, 'artifacts', 'files'),
    };
}

/**
 * Legacy run paths layout (pre-2026-02): <task_slug>/<stage>/<run_id>/...
 * Kept for backward-compatible discovery/GC of old runs still on disk.
 */
function runPathsLegacy(projectSlug, taskSlug, stage, runId) {
    const root = runRootLegacy(projectSlug, taskSlug, stage, runId);
    return {
        root,
        meta: path.join(root, 'meta.json'),
        prompt: path.join(root, 'prompt.md'),
        output: path.join(root, 'output.md'),
        decision: path.join(root, 'decision.json'),
        events: path.join(root, 'events.ndjson'),
        artifacts: path.join(root, 'artifacts'),
        logs: path.join(root, 'artifacts', 'logs.txt'),
        diff: path.join(root, 'artifacts', 'diff.patch'),
        contextSnippets: path.join(root, 'artifacts', 'context_snippets'),
        files: path.join(root, 'artifacts', 'files'),
    };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
    // Constants
    VALID_STAGES,

    // AGX Home
    getAgxHome,

    // Slug utilities
    validateSlug,
    slugify,
    slugifyUnique,

    // Run ID utilities
    generateRunId,
    validateRunId,
    validateStage,

    // Path construction
    projectsRoot,
    projectRoot,
    projectJsonPath,
    projectIndexPath,
    taskRoot,
    taskJsonPath,
    workingSetPath,
    approvalsPath,
    lastRunPath,
    taskLockPath,
    runRoot,
    runRootLegacy,
    runPaths,
    runPathsLegacy,
};
