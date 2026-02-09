/**
 * Run directory management and finalization for agx local state storage.
 * 
 * Handles:
 * - Creating run directories
 * - Writing run files (meta, prompt, output, decision)
 * - Finalization ordering (decision.json last)
 * - Crash recovery detection
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
    taskRoot,
    runRoot,
    runPaths,
    generateRunId,
    validateStage,
    VALID_STAGES,
} = require('./paths');
const { writeJsonAtomic, writeFileAtomic, readJsonSafe, ensureDir, fileExists } = require('./atomic');
const { appendEvent, runStartedEvent, runFinishedEvent, runFailedEvent, recoveryDetectedEvent, promptBuiltEvent } = require('./events');
const { updateLastRun } = require('./state');

// ============================================================
// Types
// ============================================================

/**
 * @typedef {object} GitMeta
 * @property {string} commit
 * @property {boolean} dirty
 */

/**
 * @typedef {object} RunMeta
 * @property {string} run_id
 * @property {string} project_slug
 * @property {string} task_slug
 * @property {string} stage
 * @property {string} engine
 * @property {string} [model]
 * @property {string} created_at
 * @property {GitMeta} [git]
 * @property {object} sizes
 * @property {number} [sizes.prompt_bytes]
 * @property {number} [sizes.output_bytes]
 * @property {number} [sizes.working_set_bytes]
 */

/**
 * @typedef {object} NextAction
 * @property {string} type
 * @property {string} summary
 */

/**
 * @typedef {object} Decision
 * @property {string} status - continue, done, blocked, needs_approval, failed
 * @property {string} [reason]
 * @property {NextAction[]} [next_actions]
 * @property {object} [criteria_progress]
 * @property {string[]} [criteria_progress.done]
 * @property {string[]} [criteria_progress.pending]
 * @property {object[]} [approvals_requested]
 * @property {object[]} [context_requests]
 */

/**
 * @typedef {object} RunHandle
 * @property {string} run_id
 * @property {string} project_slug
 * @property {string} task_slug
 * @property {string} stage
 * @property {object} paths - All paths for this run
 * @property {boolean} finalized
 */

// ============================================================
// Run Lifecycle
// ============================================================

/**
 * Create a new run directory and write initial meta.json stub.
 * @param {object} params
 * @param {string} params.projectSlug
 * @param {string} params.taskSlug
 * @param {string} params.stage
 * @param {string} params.engine
 * @param {string} [params.model]
 * @param {GitMeta} [params.git]
 * @returns {Promise<RunHandle>}
 */
async function createRun({ projectSlug, taskSlug, stage, engine, model, git }) {
    // Validate stage
    const stageValidation = validateStage(stage);
    if (!stageValidation.valid) {
        throw new Error(stageValidation.error);
    }

    const runId = generateRunId();
    const paths = runPaths(projectSlug, taskSlug, stage, runId);

    // Create run directory
    await ensureDir(paths.root);
    await ensureDir(paths.artifacts);

    const now = new Date().toISOString();

    /** @type {RunMeta} */
    const meta = {
        run_id: runId,
        project_slug: projectSlug,
        task_slug: taskSlug,
        stage,
        engine,
        model,
        created_at: now,
        git,
        sizes: {},
    };

    // Write meta stub
    await writeJsonAtomic(paths.meta, meta);

    // Write RUN_STARTED event
    await appendEvent(paths.events, runStartedEvent({ run_id: runId, stage }));

    /** @type {RunHandle} */
    const handle = {
        run_id: runId,
        project_slug: projectSlug,
        task_slug: taskSlug,
        stage,
        paths,
        finalized: false,
    };

    return handle;
}

/**
 * Write the prompt to a run.
 * @param {RunHandle} run
 * @param {string} promptText
 * @param {object} [event] - Optional PROMPT_BUILT event to emit
 * @returns {Promise<void>}
 */
async function writePrompt(run, promptText, event = null) {
    if (run.finalized) {
        throw new Error('Cannot write to finalized run');
    }
    await writeFileAtomic(run.paths.prompt, promptText);

    // Update sizes in meta
    const meta = await readJsonSafe(run.paths.meta);
    if (meta) {
        meta.sizes.prompt_bytes = Buffer.byteLength(promptText, 'utf8');
        await writeJsonAtomic(run.paths.meta, meta);
    }

    // Emit PROMPT_BUILT event if provided
    if (event) {
        await appendEvent(run.paths.events, event);
    }
}

/**
 * Write the output to a run.
 * @param {RunHandle} run
 * @param {string} outputText
 * @returns {Promise<void>}
 */
async function writeOutput(run, outputText) {
    if (run.finalized) {
        throw new Error('Cannot write to finalized run');
    }
    await writeFileAtomic(run.paths.output, outputText);

    // Update sizes in meta
    const meta = await readJsonSafe(run.paths.meta);
    if (meta) {
        meta.sizes.output_bytes = Buffer.byteLength(outputText, 'utf8');
        await writeJsonAtomic(run.paths.meta, meta);
    }
}

/**
 * Finalize a run by writing decision.json.
 * This must be called LAST for run integrity.
 * @param {RunHandle} run
 * @param {Decision} decision
 * @returns {Promise<void>}
 */
async function finalizeRun(run, decision) {
    if (run.finalized) {
        throw new Error('Run already finalized');
    }

    // Write RUN_FINISHED event
    await appendEvent(run.paths.events, runFinishedEvent({
        status: decision.status,
        reason: decision.reason,
    }));

    // Write decision.json LAST
    await writeJsonAtomic(run.paths.decision, decision);

    // Update last_run
    await updateLastRun(run.project_slug, run.task_slug, run.stage, run.run_id);

    run.finalized = true;
}

/**
 * Mark a run as failed.
 * @param {RunHandle} run
 * @param {object} params
 * @param {string} params.error
 * @param {string} [params.code]
 * @returns {Promise<void>}
 */
async function failRun(run, { error, code }) {
    if (run.finalized) {
        throw new Error('Run already finalized');
    }

    // Write RUN_FAILED event
    await appendEvent(run.paths.events, runFailedEvent({ error, code }));

    // Write failed decision
    const decision = {
        status: 'failed',
        reason: error,
        error_code: code,
    };

    await writeJsonAtomic(run.paths.decision, decision);
    await updateLastRun(run.project_slug, run.task_slug, run.stage, run.run_id);

    run.finalized = true;
}

/**
 * Write an artifact file to a run.
 * @param {RunHandle} run
 * @param {string} relativePath - Path relative to artifacts/
 * @param {string|Buffer} data
 * @returns {Promise<void>}
 */
async function writeArtifact(run, relativePath, data) {
    if (run.finalized) {
        throw new Error('Cannot write to finalized run');
    }

    const fullPath = path.join(run.paths.artifacts, relativePath);
    await ensureDir(path.dirname(fullPath));
    await writeFileAtomic(fullPath, data);
}

// ============================================================
// Run Discovery and Recovery
// ============================================================

/**
 * List all runs for a task.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {object} [options]
 * @param {string} [options.stage] - Filter by stage
 * @returns {Promise<{ stage: string, run_id: string, meta: RunMeta|null, hasDecision: boolean }[]>}
 */
async function listRuns(projectSlug, taskSlug, options = {}) {
    const taskPath = taskRoot(projectSlug, taskSlug);
    const stages = options.stage ? [options.stage] : VALID_STAGES;

    const runs = [];

    for (const stage of stages) {
        const stagePath = path.join(taskPath, stage);

        try {
            const entries = await fs.promises.readdir(stagePath, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                const runId = entry.name;
                const paths = runPaths(projectSlug, taskSlug, stage, runId);

                const meta = await readJsonSafe(paths.meta);
                const hasDecision = await fileExists(paths.decision);

                runs.push({
                    stage,
                    run_id: runId,
                    meta,
                    hasDecision,
                });
            }
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
            // Stage directory doesn't exist - skip
        }
    }

    // Sort by run_id (which is sortable by timestamp)
    runs.sort((a, b) => a.run_id.localeCompare(b.run_id));

    return runs;
}

/**
 * Find incomplete runs (meta.json exists but decision.json missing).
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @returns {Promise<{ stage: string, run_id: string, meta: RunMeta }[]>}
 */
async function findIncompleteRuns(projectSlug, taskSlug) {
    const allRuns = await listRuns(projectSlug, taskSlug);

    return allRuns
        .filter(r => r.meta && !r.hasDecision)
        .map(r => ({
            stage: r.stage,
            run_id: r.run_id,
            meta: r.meta,
        }));
}

/**
 * Create a recovery run for an incomplete run.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {object} incompleteRun
 * @param {string} incompleteRun.stage
 * @param {string} incompleteRun.run_id
 * @param {RunMeta} incompleteRun.meta
 * @returns {Promise<RunHandle>}
 */
async function createRecoveryRun(projectSlug, taskSlug, incompleteRun) {
    // Close the incomplete run first
    await closeIncompleteRun(projectSlug, taskSlug, incompleteRun.stage, incompleteRun.run_id);

    // Now create the recovery run
    const run = await createRun({
        projectSlug,
        taskSlug,
        stage: 'resume',
        engine: incompleteRun.meta.engine,
        model: incompleteRun.meta.model,
    });

    // Record recovery event in the new recovery run
    await appendEvent(run.paths.events, recoveryDetectedEvent({
        incomplete_run_id: incompleteRun.run_id,
        stage: incompleteRun.stage,
    }));

    return run;
}

/**
 * Close an incomplete run by writing a failed decision.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {string} stage
 * @param {string} runId
 * @returns {Promise<void>}
 */
async function closeIncompleteRun(projectSlug, taskSlug, stage, runId) {
    const paths = runPaths(projectSlug, taskSlug, stage, runId);

    // Check if already closed
    if (await fileExists(paths.decision)) {
        return;
    }

    /** @type {Decision} */
    const decision = {
        status: 'failed',
        reason: 'Run crashed or was interrupted before completion',
        error_code: 'CRASHED',
    };

    // Write decision.json
    await writeJsonAtomic(paths.decision, decision);

    // Also append RUN_FAILED event
    await appendEvent(paths.events, runFailedEvent({
        error: 'Run crashed or was interrupted',
        code: 'CRASHED'
    }));
}

/**
 * Read the decision from a completed run.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {string} stage
 * @param {string} runId
 * @returns {Promise<Decision|null>}
 */
async function readDecision(projectSlug, taskSlug, stage, runId) {
    const paths = runPaths(projectSlug, taskSlug, stage, runId);
    return readJsonSafe(paths.decision);
}

/**
 * Read the meta from a run.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {string} stage
 * @param {string} runId
 * @returns {Promise<RunMeta|null>}
 */
async function readRunMeta(projectSlug, taskSlug, stage, runId) {
    const paths = runPaths(projectSlug, taskSlug, stage, runId);
    return readJsonSafe(paths.meta);
}

// ============================================================
// Garbage Collection
// ============================================================

/**
 * Clean up old runs, keeping the newest N per stage.
 * @param {string} projectSlug
 * @param {string} taskSlug
 * @param {object} [options]
 * @param {number} [options.keep=25] - Number of runs to keep per stage
 * @param {boolean} [options.preserveBlockedFailed=true] - Preserve runs for blocked/failed tasks
 * @returns {Promise<{ deleted: number, preserved: number }>}
 */
async function gcRuns(projectSlug, taskSlug, options = {}) {
    const keep = options.keep ?? 25;
    const preserveBlockedFailed = options.preserveBlockedFailed ?? true;

    // Check task status
    const { readTaskState } = require('./state');
    const task = await readTaskState(projectSlug, taskSlug);

    if (preserveBlockedFailed && task && ['blocked', 'failed'].includes(task.status)) {
        return { deleted: 0, preserved: 0 };
    }

    let deleted = 0;
    let preserved = 0;

    for (const stage of VALID_STAGES) {
        const runs = await listRuns(projectSlug, taskSlug, { stage });

        // Keep the newest N runs
        const toDelete = runs.slice(0, -keep);
        preserved += Math.min(runs.length, keep);

        for (const run of toDelete) {
            const runPath = runRoot(projectSlug, taskSlug, stage, run.run_id);
            try {
                await fs.promises.rm(runPath, { recursive: true, force: true });
                deleted++;
            } catch (err) {
                console.warn(`Warning: Failed to delete run ${run.run_id}:`, err.message);
            }
        }
    }

    return { deleted, preserved };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
    // Run lifecycle
    createRun,
    writePrompt,
    writeOutput,
    finalizeRun,
    failRun,
    writeArtifact,

    // Discovery and recovery
    listRuns,
    findIncompleteRuns,
    createRecoveryRun,
    closeIncompleteRun,
    readDecision,
    readRunMeta,

    // Garbage collection
    gcRuns,
};
