/**
 * Canonical state read/write operations for agx local state storage.
 * 
 * Handles:
 * - project.json, index.json
 * - task.json, working_set.md, approvals.json, last_run.json
 */

const fs = require('fs');
const path = require('path');
const {
    projectRoot,
    projectJsonPath,
    projectIndexPath,
    taskRoot,
    taskJsonPath,
    workingSetPath,
    approvalsPath,
    lastRunPath,
    validateSlug,
    slugify,
} = require('./paths');
const { writeJsonAtomic, writeFileAtomic, readJsonSafe, readTextSafe, ensureDir } = require('./atomic');

// ============================================================
// Constants
// ============================================================

const WORKING_SET_MAX_CHARS = 4000;
const VALID_TASK_STATUSES = ['pending', 'running', 'done', 'blocked', 'failed'];
const VALID_DECISION_STATUSES = ['continue', 'done', 'blocked', 'needs_approval', 'failed'];

// ============================================================
// Project State
// ============================================================

/**
 * @typedef {object} ProjectState
 * @property {string} project_slug
 * @property {string} repo_path
 * @property {string} created_at
 * @property {string} [default_engine]
 */

/**
 * Read a project's state.
 * @param {string} projectSlug
 * @returns {Promise<ProjectState|null>}
 */
async function readProjectState(projectSlug) {
    const filePath = projectJsonPath(projectSlug);
    return readJsonSafe(filePath);
}

/**
 * Write/update a project's state.
 * @param {string} projectSlug
 * @param {Partial<ProjectState>} state
 * @returns {Promise<ProjectState>}
 */
async function writeProjectState(projectSlug, state) {
    const filePath = projectJsonPath(projectSlug);
    const existing = await readJsonSafe(filePath);

    const merged = {
        project_slug: projectSlug,
        created_at: new Date().toISOString(),
        ...existing,
        ...state,
        project_slug: projectSlug, // Ensure slug cannot be changed
    };

    await ensureDir(projectRoot(projectSlug));
    await writeJsonAtomic(filePath, merged);
    return merged;
}

/**
 * @typedef {object} ProjectIndexEntry
 * @property {string} task_slug
 * @property {string} status
 * @property {string} updated_at
 */

/**
 * @typedef {object} ProjectIndex
 * @property {string} project_slug
 * @property {ProjectIndexEntry[]} tasks
 */

/**
 * Read a project's task index.
 * @param {string} projectSlug
 * @returns {Promise<ProjectIndex>}
 */
async function readProjectIndex(projectSlug) {
    const filePath = projectIndexPath(projectSlug);
    const existing = await readJsonSafe(filePath);
    return existing || { project_slug: projectSlug, tasks: [] };
}

/**
 * Write a project's task index.
 * @param {string} projectSlug
 * @param {ProjectIndex} index
 * @returns {Promise<void>}
 */
async function writeProjectIndex(projectSlug, index) {
    const filePath = projectIndexPath(projectSlug);
    await ensureDir(projectRoot(projectSlug));
    await writeJsonAtomic(filePath, { ...index, project_slug: projectSlug });
}

/**
 * Update a task's entry in the project index.
 * Creates the entry if it doesn't exist.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {Partial<ProjectIndexEntry>} updates
 * @returns {Promise<void>}
 */
async function updateProjectIndexEntry(projectSlug, taskSlug, updates) {
    const index = await readProjectIndex(projectSlug);
    const existingIdx = index.tasks.findIndex(t => t.task_slug === taskSlug);

    const entry = {
        task_slug: taskSlug,
        status: 'pending',
        updated_at: new Date().toISOString(),
        ...(existingIdx >= 0 ? index.tasks[existingIdx] : {}),
        ...updates,
        task_slug: taskSlug, // Ensure slug cannot be changed
        updated_at: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
        index.tasks[existingIdx] = entry;
    } else {
        index.tasks.push(entry);
    }

    await writeProjectIndex(projectSlug, index);
}

/**
 * Remove a task from the project index.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @returns {Promise<void>}
 */
async function removeProjectIndexEntry(projectSlug, taskSlug) {
    const index = await readProjectIndex(projectSlug);
    index.tasks = index.tasks.filter(t => t.task_slug !== taskSlug);
    await writeProjectIndex(projectSlug, index);
}

// ============================================================
// Task State
// ============================================================

/**
 * @typedef {object} TaskState
 * @property {string} task_slug
 * @property {string} user_request - Immutable after creation
 * @property {string} goal
 * @property {string[]} criteria
 * @property {string} status - pending, running, done, blocked, failed
 * @property {string} created_at
 * @property {string} updated_at
 * @property {object} [cloud] - Optional cloud references
 */

/**
 * Read a task's state.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @returns {Promise<TaskState|null>}
 */
async function readTaskState(projectSlug, taskSlug) {
    const filePath = taskJsonPath(projectSlug, taskSlug);
    return readJsonSafe(filePath);
}

/**
 * Create a new task.
 * @param {string} projectSlug
 * @param {object} params
 * @param {string} params.user_request
 * @param {string} [params.goal]
 * @param {string[]} [params.criteria]
 * @param {string} [params.taskSlug] - Optional custom slug
 * @returns {Promise<TaskState>}
 */
async function createTask(projectSlug, params) {
    const { user_request, goal, criteria = [], taskSlug: customSlug } = params;

    if (!user_request) {
        throw new Error('user_request is required');
    }

    // Generate task slug if not provided
    const projectPath = projectRoot(projectSlug);
    const taskSlug = customSlug || await generateTaskSlug(projectPath, user_request);

    const taskPath = taskRoot(projectSlug, taskSlug);
    const filePath = taskJsonPath(projectSlug, taskSlug);

    // Check if task already exists
    const existing = await readJsonSafe(filePath);
    if (existing) {
        throw new Error(`Task ${taskSlug} already exists in project ${projectSlug}`);
    }

    const now = new Date().toISOString();

    /** @type {TaskState} */
    const state = {
        task_slug: taskSlug,
        user_request,
        goal: goal || user_request,
        criteria,
        status: 'pending',
        created_at: now,
        updated_at: now,
    };

    await ensureDir(taskPath);
    await writeJsonAtomic(filePath, state);

    // Update project index
    await updateProjectIndexEntry(projectSlug, taskSlug, { status: 'pending' });

    // Initialize empty working set
    await writeWorkingSet(projectSlug, taskSlug, '');

    // Initialize empty approvals
    await writeApprovals(projectSlug, taskSlug, { pending: [], approved: [], rejected: [] });

    // Initialize empty last_run
    await writeLastRun(projectSlug, taskSlug, {});

    return state;
}

/**
 * Update a task's state.
 * Note: user_request is immutable and cannot be changed.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {Partial<TaskState>} updates
 * @returns {Promise<TaskState>}
 */
async function updateTaskState(projectSlug, taskSlug, updates) {
    const filePath = taskJsonPath(projectSlug, taskSlug);
    const existing = await readJsonSafe(filePath);

    if (!existing) {
        throw new Error(`Task ${taskSlug} not found in project ${projectSlug}`);
    }

    // Prevent changing immutable fields
    const { user_request, task_slug, created_at, ...allowedUpdates } = updates;

    const merged = {
        ...existing,
        ...allowedUpdates,
        task_slug: existing.task_slug,
        user_request: existing.user_request,
        created_at: existing.created_at,
        updated_at: new Date().toISOString(),
    };

    await writeJsonAtomic(filePath, merged);

    // Update project index if status changed
    if (updates.status) {
        await updateProjectIndexEntry(projectSlug, taskSlug, { status: updates.status });
    }

    return merged;
}

/**
 * Generate a unique task slug from user request.
 * @param {string} projectPath
 * @param {string} userRequest
 * @returns {Promise<string>}
 */
async function generateTaskSlug(projectPath, userRequest) {
    const baseSlug = slugify(userRequest.slice(0, 50), { maxLength: 40 });

    // Check for collisions
    let candidate = baseSlug;
    let suffix = 0;

    while (true) {
        const candidatePath = path.join(projectPath, candidate, 'task.json');
        const exists = await readJsonSafe(candidatePath);

        if (!exists) {
            return candidate;
        }

        suffix++;
        candidate = `${baseSlug}-${suffix}`;

        if (suffix > 100) {
            // Fail-safe: add random suffix
            const crypto = require('crypto');
            return `${baseSlug}-${crypto.randomBytes(2).toString('hex')}`;
        }
    }
}

// ============================================================
// Working Set
// ============================================================

/**
 * Read a task's working set.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @returns {Promise<string>}
 */
async function readWorkingSet(projectSlug, taskSlug) {
    const filePath = workingSetPath(projectSlug, taskSlug);
    const content = await readTextSafe(filePath);
    return content || '';
}

/**
 * Write a task's working set.
 * Enforces character cap - will summarize if exceeded.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {string} content
 * @param {object} [options]
 * @param {number} [options.maxChars] - Override default max chars
 * @param {(content: string, maxChars: number) => string} [options.summarizer] - Custom summarizer
 * @returns {Promise<{ written: string, rewritten: boolean, originalBytes: number, newBytes: number }>}
 */
async function writeWorkingSet(projectSlug, taskSlug, content, options = {}) {
    const maxChars = options.maxChars || WORKING_SET_MAX_CHARS;
    const filePath = workingSetPath(projectSlug, taskSlug);

    const originalBytes = Buffer.byteLength(content, 'utf8');
    let finalContent = content;
    let rewritten = false;

    if (content.length > maxChars) {
        // Use custom summarizer if provided, otherwise truncate with marker
        if (options.summarizer) {
            finalContent = options.summarizer(content, maxChars);
        } else {
            // Default: truncate with continuation marker
            finalContent = content.slice(0, maxChars - 50) + '\n\n<!-- truncated: content exceeded cap -->';
        }
        rewritten = true;
    }

    await ensureDir(path.dirname(filePath));
    await writeFileAtomic(filePath, finalContent);

    const newBytes = Buffer.byteLength(finalContent, 'utf8');

    return {
        written: finalContent,
        rewritten,
        originalBytes,
        newBytes,
    };
}

// ============================================================
// Approvals
// ============================================================

/**
 * @typedef {object} ApprovalRequest
 * @property {string} id
 * @property {string} action
 * @property {string} reason
 * @property {string} created_at
 */

/**
 * @typedef {object} Approvals
 * @property {ApprovalRequest[]} pending
 * @property {ApprovalRequest[]} approved
 * @property {ApprovalRequest[]} rejected
 */

/**
 * Read a task's approvals.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @returns {Promise<Approvals>}
 */
async function readApprovals(projectSlug, taskSlug) {
    const filePath = approvalsPath(projectSlug, taskSlug);
    const existing = await readJsonSafe(filePath);
    return existing || { pending: [], approved: [], rejected: [] };
}

/**
 * Write a task's approvals.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {Approvals} approvals
 * @returns {Promise<void>}
 */
async function writeApprovals(projectSlug, taskSlug, approvals) {
    const filePath = approvalsPath(projectSlug, taskSlug);
    await ensureDir(path.dirname(filePath));
    await writeJsonAtomic(filePath, approvals);
}

/**
 * Add a pending approval request.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {object} params
 * @param {string} params.action
 * @param {string} params.reason
 * @returns {Promise<ApprovalRequest>}
 */
async function addPendingApproval(projectSlug, taskSlug, { action, reason }) {
    const approvals = await readApprovals(projectSlug, taskSlug);

    const crypto = require('crypto');
    const request = {
        id: `appr_${crypto.randomBytes(4).toString('hex')}`,
        action,
        reason,
        created_at: new Date().toISOString(),
    };

    approvals.pending.push(request);
    await writeApprovals(projectSlug, taskSlug, approvals);

    return request;
}

/**
 * Approve a pending request.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {string} approvalId
 * @returns {Promise<ApprovalRequest|null>}
 */
async function approveRequest(projectSlug, taskSlug, approvalId) {
    const approvals = await readApprovals(projectSlug, taskSlug);
    const idx = approvals.pending.findIndex(r => r.id === approvalId);

    if (idx < 0) {
        return null;
    }

    const [request] = approvals.pending.splice(idx, 1);
    approvals.approved.push(request);
    await writeApprovals(projectSlug, taskSlug, approvals);

    return request;
}

/**
 * Reject a pending request.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {string} approvalId
 * @returns {Promise<ApprovalRequest|null>}
 */
async function rejectRequest(projectSlug, taskSlug, approvalId) {
    const approvals = await readApprovals(projectSlug, taskSlug);
    const idx = approvals.pending.findIndex(r => r.id === approvalId);

    if (idx < 0) {
        return null;
    }

    const [request] = approvals.pending.splice(idx, 1);
    approvals.rejected.push(request);
    await writeApprovals(projectSlug, taskSlug, approvals);

    return request;
}

// ============================================================
// Last Run Tracking
// ============================================================

/**
 * @typedef {object} RunRef
 * @property {string} run_id
 * @property {string} [stage]
 */

/**
 * @typedef {object} LastRunState
 * @property {RunRef} [overall]
 * @property {RunRef} [plan]
 * @property {RunRef} [execute]
 * @property {RunRef} [verify]
 * @property {RunRef} [resume]
 */

/**
 * Read a task's last run state.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @returns {Promise<LastRunState>}
 */
async function readLastRun(projectSlug, taskSlug) {
    const filePath = lastRunPath(projectSlug, taskSlug);
    const existing = await readJsonSafe(filePath);
    return existing || {};
}

/**
 * Write a task's last run state.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {LastRunState} lastRun
 * @returns {Promise<void>}
 */
async function writeLastRun(projectSlug, taskSlug, lastRun) {
    const filePath = lastRunPath(projectSlug, taskSlug);
    await ensureDir(path.dirname(filePath));
    await writeJsonAtomic(filePath, lastRun);
}

/**
 * Update last run after completing a run.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {string} stage
 * @param {string} runId
 * @returns {Promise<void>}
 */
async function updateLastRun(projectSlug, taskSlug, stage, runId) {
    const lastRun = await readLastRun(projectSlug, taskSlug);

    lastRun.overall = { stage, run_id: runId };
    lastRun[stage] = { run_id: runId };

    await writeLastRun(projectSlug, taskSlug, lastRun);
}

// ============================================================
// Exports
// ============================================================

module.exports = {
    // Constants
    WORKING_SET_MAX_CHARS,
    VALID_TASK_STATUSES,
    VALID_DECISION_STATUSES,

    // Project state
    readProjectState,
    writeProjectState,
    readProjectIndex,
    writeProjectIndex,
    updateProjectIndexEntry,
    removeProjectIndexEntry,

    // Task state
    readTaskState,
    createTask,
    updateTaskState,

    // Working set
    readWorkingSet,
    writeWorkingSet,

    // Approvals
    readApprovals,
    writeApprovals,
    addPendingApproval,
    approveRequest,
    rejectRequest,

    // Last run
    readLastRun,
    writeLastRun,
    updateLastRun,
};
