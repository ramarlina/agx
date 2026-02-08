/**
 * Local-first CLI commands for agx.
 * 
 * These commands operate on ~/.agx/projects/ and do not require network.
 * They implement the local-first task lifecycle from the spec.
 */

const path = require('path');
const storage = require('./storage');

// ============================================================
// Colors (matching main CLI)
// ============================================================

const c = process.stdout.isTTY ? {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', cyan: '\x1b[36m',
} : { reset: '', bold: '', dim: '', red: '', green: '', yellow: '', blue: '', cyan: '' };

// ============================================================
// Project Detection
// ============================================================

/**
 * Detect the current project from the working directory.
 * @param {string} [cwd] - Working directory (defaults to process.cwd())
 * @returns {Promise<{ projectSlug: string, repoPath: string } | null>}
 */
async function detectProject(cwd = process.cwd()) {
    // Try to find .git root
    let dir = cwd;
    while (dir !== path.dirname(dir)) {
        const gitPath = path.join(dir, '.git');
        try {
            const stat = await require('fs').promises.stat(gitPath);
            if (stat.isDirectory() || stat.isFile()) {
                // Found git root - derive project slug from folder name
                const folderName = path.basename(dir);
                const projectSlug = storage.slugify(folderName);
                return { projectSlug, repoPath: dir };
            }
        } catch {
            // Not found, continue up
        }
        dir = path.dirname(dir);
    }

    // No git repo found - use current folder name
    const folderName = path.basename(cwd);
    const projectSlug = storage.slugify(folderName);
    return { projectSlug, repoPath: cwd };
}

/**
 * Ensure project exists in local storage.
 * @param {string} projectSlug
 * @param {string} repoPath
 * @returns {Promise<object>}
 */
async function ensureProject(projectSlug, repoPath) {
    let project = await storage.readProjectState(projectSlug);

    if (!project) {
        project = await storage.writeProjectState(projectSlug, {
            repo_path: repoPath,
            default_engine: 'claude',
        });
    }

    return project;
}

// ============================================================
// CLI Commands
// ============================================================

/**
 * Create a new task (local-first).
 * @param {object} params
 * @param {string} params.userRequest - The user's request/goal
 * @param {string} [params.projectSlug] - Project slug (auto-detected if not provided)
 * @param {string} [params.engine] - Engine to use (claude, gemini, etc.)
 * @param {boolean} [params.json] - Output JSON
 * @returns {Promise<{ task: object, project: object }>}
 */
async function cmdNew({ userRequest, projectSlug, engine, json = false }) {
    if (!userRequest) {
        throw new Error('Task description is required');
    }

    // Detect project if not specified
    let repoPath = process.cwd();
    if (!projectSlug) {
        const detected = await detectProject();
        projectSlug = detected.projectSlug;
        repoPath = detected.repoPath;
    }

    // Ensure project exists
    const project = await ensureProject(projectSlug, repoPath);

    // Create task
    const task = await storage.createTask(projectSlug, {
        user_request: userRequest,
        goal: userRequest,
        criteria: [],
    });

    // Initialize working set with basic structure
    const initialWorkingSet = `# Working Set

## Current Plan
- [ ] Understand the request
- [ ] Plan approach
- [ ] Implement solution
- [ ] Verify correctness

## Constraints
- None specified

## Next Action
Analyze the user request and create a detailed plan.

## Open Questions
- None yet
`;

    await storage.writeWorkingSet(projectSlug, task.task_slug, initialWorkingSet);

    if (json) {
        console.log(JSON.stringify({
            success: true,
            project_slug: projectSlug,
            task_slug: task.task_slug,
            status: task.status,
        }));
    } else {
        console.log(`${c.green}✓${c.reset} Task created locally`);
        console.log(`  ${c.dim}Project:${c.reset} ${projectSlug}`);
        console.log(`  ${c.dim}Task:${c.reset} ${task.task_slug}`);
        console.log(`  ${c.dim}Location:${c.reset} ${storage.taskRoot(projectSlug, task.task_slug)}`);
    }

    return { task, project };
}

/**
 * List tasks (local-first).
 * @param {object} params
 * @param {string} [params.projectSlug] - Project slug (auto-detected if not provided)
 * @param {boolean} [params.all] - Show all statuses
 * @param {boolean} [params.json] - Output JSON
 * @returns {Promise<{ tasks: object[] }>}
 */
async function cmdTasks({ projectSlug, all = false, json = false }) {
    // Detect project if not specified
    if (!projectSlug) {
        const detected = await detectProject();
        projectSlug = detected.projectSlug;
    }

    const index = await storage.readProjectIndex(projectSlug);
    let tasks = index.tasks;

    // Filter by status unless --all
    if (!all) {
        tasks = tasks.filter(t => !['done', 'completed'].includes(t.status));
    }

    if (json) {
        console.log(JSON.stringify({ project_slug: projectSlug, tasks }));
    } else {
        if (tasks.length === 0) {
            console.log(`${c.dim}No tasks found${c.reset}`);
            console.log(`${c.dim}Create one with: agx new "your task"${c.reset}`);
            return { tasks: [] };
        }

        console.log(`${c.bold}Local Tasks${c.reset} (${tasks.length})  ${c.dim}[${projectSlug}]${c.reset}\n`);

        let idx = 1;
        for (const t of tasks) {
            const statusIcon = {
                pending: c.yellow + '○' + c.reset,
                running: c.blue + '●' + c.reset,
                done: c.green + '✓' + c.reset,
                blocked: c.red + '⏸' + c.reset,
                failed: c.red + '✗' + c.reset,
            }[t.status] || '?';

            console.log(`  ${c.dim}${idx}.${c.reset} ${statusIcon} ${t.task_slug}`);
            console.log(`    ${c.dim}${t.status} · updated ${formatRelativeTime(t.updated_at)}${c.reset}`);
            idx++;
        }
    }

    return { tasks };
}

/**
 * Show task details.
 * @param {object} params
 * @param {string} params.taskSlug - Task slug or index (#1, #2, etc.)
 * @param {string} [params.projectSlug] - Project slug (auto-detected)
 * @param {boolean} [params.json] - Output JSON
 */
async function cmdShow({ taskSlug, projectSlug, json = false }) {
    if (!projectSlug) {
        const detected = await detectProject();
        projectSlug = detected.projectSlug;
    }

    // Resolve task slug from index if needed
    taskSlug = await resolveTaskSlug(projectSlug, taskSlug);

    const task = await storage.readTaskState(projectSlug, taskSlug);
    if (!task) {
        throw new Error(`Task not found: ${taskSlug}`);
    }

    const workingSet = await storage.readWorkingSet(projectSlug, taskSlug);
    const lastRun = await storage.readLastRun(projectSlug, taskSlug);
    const approvals = await storage.readApprovals(projectSlug, taskSlug);

    if (json) {
        console.log(JSON.stringify({ task, workingSet, lastRun, approvals }));
    } else {
        console.log(`${c.bold}${task.task_slug}${c.reset}  ${c.dim}[${task.status}]${c.reset}\n`);
        console.log(`${c.cyan}User Request:${c.reset}`);
        console.log(`  ${task.user_request}\n`);

        if (task.goal !== task.user_request) {
            console.log(`${c.cyan}Goal:${c.reset}`);
            console.log(`  ${task.goal}\n`);
        }

        if (task.criteria && task.criteria.length > 0) {
            console.log(`${c.cyan}Criteria:${c.reset}`);
            for (const c of task.criteria) {
                console.log(`  - ${c}`);
            }
            console.log('');
        }

        if (lastRun.overall) {
            console.log(`${c.cyan}Last Run:${c.reset}`);
            console.log(`  Stage: ${lastRun.overall.stage}`);
            console.log(`  Run ID: ${lastRun.overall.run_id}\n`);
        }

        if (approvals.pending.length > 0) {
            console.log(`${c.yellow}Pending Approvals:${c.reset}`);
            for (const a of approvals.pending) {
                console.log(`  [${a.id}] ${a.action}`);
            }
            console.log('');
        }

        console.log(`${c.dim}Path: ${storage.taskRoot(projectSlug, taskSlug)}${c.reset}`);
    }

    return { task, workingSet, lastRun, approvals };
}

/**
 * List runs for a task.
 * @param {object} params
 * @param {string} params.taskSlug
 * @param {string} [params.projectSlug]
 * @param {string} [params.stage] - Filter by stage
 * @param {boolean} [params.json]
 */
async function cmdRuns({ taskSlug, projectSlug, stage, json = false }) {
    if (!projectSlug) {
        const detected = await detectProject();
        projectSlug = detected.projectSlug;
    }

    taskSlug = await resolveTaskSlug(projectSlug, taskSlug);

    const runs = await storage.listRuns(projectSlug, taskSlug, { stage });

    if (json) {
        console.log(JSON.stringify({ runs }));
    } else {
        if (runs.length === 0) {
            console.log(`${c.dim}No runs found${c.reset}`);
            return { runs: [] };
        }

        console.log(`${c.bold}Runs${c.reset} (${runs.length})  ${c.dim}[${taskSlug}]${c.reset}\n`);

        for (const run of runs.slice(-20).reverse()) {
            const statusIcon = run.hasDecision ? c.green + '✓' + c.reset : c.yellow + '○' + c.reset;
            console.log(`  ${statusIcon} ${run.stage}/${run.run_id}`);
        }
    }

    return { runs };
}

/**
 * Complete a task (local-first).
 * @param {object} params
 * @param {string} params.taskSlug
 * @param {string} [params.projectSlug]
 * @param {boolean} [params.json]
 */
async function cmdComplete({ taskSlug, projectSlug, json = false }) {
    if (!projectSlug) {
        const detected = await detectProject();
        projectSlug = detected.projectSlug;
    }

    taskSlug = await resolveTaskSlug(projectSlug, taskSlug);

    const task = await storage.updateTaskState(projectSlug, taskSlug, {
        status: 'done',
    });

    if (json) {
        console.log(JSON.stringify({ success: true, task }));
    } else {
        console.log(`${c.green}✓${c.reset} Task marked complete: ${taskSlug}`);
    }

    return { task };
}

/**
 * Run garbage collection.
 * @param {object} params
 * @param {string} [params.projectSlug]
 * @param {string} [params.taskSlug]
 * @param {number} [params.keep=25]
 * @param {boolean} [params.json]
 */
async function cmdGc({ projectSlug, taskSlug, keep = 25, json = false }) {
    if (!projectSlug) {
        const detected = await detectProject();
        projectSlug = detected.projectSlug;
    }

    let totalDeleted = 0;
    let totalPreserved = 0;

    if (taskSlug) {
        // GC single task
        taskSlug = await resolveTaskSlug(projectSlug, taskSlug);
        const result = await storage.gcRuns(projectSlug, taskSlug, { keep });
        totalDeleted += result.deleted;
        totalPreserved += result.preserved;
    } else {
        // GC all tasks in project
        const index = await storage.readProjectIndex(projectSlug);
        for (const t of index.tasks) {
            const result = await storage.gcRuns(projectSlug, t.task_slug, { keep });
            totalDeleted += result.deleted;
            totalPreserved += result.preserved;
        }
    }

    if (json) {
        console.log(JSON.stringify({ deleted: totalDeleted, preserved: totalPreserved }));
    } else {
        console.log(`${c.green}✓${c.reset} Garbage collection complete`);
        console.log(`  Deleted: ${totalDeleted} runs`);
        console.log(`  Preserved: ${totalPreserved} runs`);
    }

    return { deleted: totalDeleted, preserved: totalPreserved };
}

/**
 * Run a task locally (execute stage).
 * @param {object} params
 * @param {string} params.taskSlug
 * @param {string} [params.projectSlug]
 * @param {string} [params.stage='execute']
 * @param {string} [params.engine='claude']
 * @param {boolean} [params.json]
 */
async function cmdRun({ taskSlug, projectSlug, stage = 'execute', engine = 'claude', json = false }) {
    if (!projectSlug) {
        const detected = await detectProject();
        projectSlug = detected.projectSlug;
    }

    taskSlug = await resolveTaskSlug(projectSlug, taskSlug);

    // Check task exists
    const task = await storage.readTaskState(projectSlug, taskSlug);
    if (!task) {
        throw new Error(`Task not found: ${taskSlug}`);
    }

    // Acquire lock
    const taskRoot = storage.taskRoot(projectSlug, taskSlug);
    let lockHandle;
    try {
        lockHandle = await storage.acquireTaskLock(taskRoot);
    } catch (err) {
        throw new Error(`Task is locked: ${err.message}`);
    }

    try {
        // Update task status
        await storage.updateTaskState(projectSlug, taskSlug, { status: 'running' });

        // Check for incomplete runs and create recovery if needed
        const incomplete = await storage.findIncompleteRuns(projectSlug, taskSlug);
        if (incomplete.length > 0) {
            if (!json) {
                console.log(`${c.yellow}⚠${c.reset} Found ${incomplete.length} incomplete run(s), creating recovery...`);
            }
            for (const inc of incomplete) {
                await storage.createRecoveryRun(projectSlug, taskSlug, inc);
            }
        }

        // Create run
        const run = await storage.createRun({
            projectSlug,
            taskSlug,
            stage,
            engine,
        });

        if (!json) {
            console.log(`${c.green}✓${c.reset} Created run: ${run.run_id}`);
            console.log(`  ${c.dim}Stage:${c.reset} ${stage}`);
            console.log(`  ${c.dim}Engine:${c.reset} ${engine}`);
        }

        // Build prompt
        const { promptText, totalBytes } = await storage.buildPrompt({
            projectSlug,
            taskSlug,
        });

        await storage.writePrompt(run, promptText);

        if (!json) {
            console.log(`  ${c.dim}Prompt:${c.reset} ${totalBytes} bytes`);
            console.log(`\n${c.cyan}Ready to execute.${c.reset}`);
            console.log(`  Run path: ${run.paths.root}`);
            console.log(`  Prompt: ${run.paths.prompt}`);
        }

        // Return info for external executor
        if (json) {
            console.log(JSON.stringify({
                success: true,
                run_id: run.run_id,
                stage,
                engine,
                prompt_path: run.paths.prompt,
                prompt_bytes: totalBytes,
            }));
        }

        return { run, promptText, totalBytes };

    } finally {
        // Release lock
        await storage.releaseTaskLock(lockHandle);
    }
}

/**
 * Force unlock a task.
 * @param {object} params
 * @param {string} params.taskSlug
 * @param {string} [params.projectSlug]
 * @param {boolean} [params.json]
 */
async function cmdUnlock({ taskSlug, projectSlug, json = false }) {
    if (!projectSlug) {
        const detected = await detectProject();
        projectSlug = detected.projectSlug;
    }

    taskSlug = await resolveTaskSlug(projectSlug, taskSlug);

    const taskRoot = storage.taskRoot(projectSlug, taskSlug);
    const lockPath = require('path').join(taskRoot, '.lock');

    try {
        const fs = require('fs').promises;
        await fs.unlink(lockPath);

        if (json) {
            console.log(JSON.stringify({ success: true, unlocked: taskSlug }));
        } else {
            console.log(`${c.green}✓${c.reset} Task unlocked: ${taskSlug}`);
        }

        return { unlocked: true };
    } catch (err) {
        if (err.code === 'ENOENT') {
            if (json) {
                console.log(JSON.stringify({ success: true, unlocked: taskSlug, was_locked: false }));
            } else {
                console.log(`${c.dim}Task was not locked: ${taskSlug}${c.reset}`);
            }
            return { unlocked: false };
        }
        throw err;
    }
}

/**
 * Tail events for a task's latest run.
 * @param {object} params
 * @param {string} params.taskSlug
 * @param {string} [params.projectSlug]
 * @param {boolean} [params.json]
 */
async function cmdTail({ taskSlug, projectSlug, json = false }) {
    if (!projectSlug) {
        const detected = await detectProject();
        projectSlug = detected.projectSlug;
    }

    taskSlug = await resolveTaskSlug(projectSlug, taskSlug);

    // Get last run info
    const lastRun = await storage.readLastRun(projectSlug, taskSlug);
    if (!lastRun.overall) {
        if (json) {
            console.log(JSON.stringify({ events: [] }));
        } else {
            console.log(`${c.dim}No runs found for task: ${taskSlug}${c.reset}`);
        }
        return { events: [] };
    }

    const { stage, run_id } = lastRun.overall;
    const runPaths = storage.runPaths(projectSlug, taskSlug, stage, run_id);

    // Read events
    const events = await storage.readEvents(runPaths.events);

    if (json) {
        console.log(JSON.stringify({ run_id, stage, events }));
    } else {
        console.log(`${c.bold}Events${c.reset} [${stage}/${run_id}]\n`);
        for (const event of events) {
            const time = new Date(event.at).toLocaleTimeString();
            const typeColor = {
                RUN_STARTED: c.green,
                RUN_FINISHED: c.green,
                RUN_FAILED: c.red,
                PROMPT_BUILT: c.cyan,
                RECOVERY_DETECTED: c.yellow,
            }[event.t] || c.dim;
            console.log(`  ${c.dim}${time}${c.reset} ${typeColor}${event.t}${c.reset}`);
        }
    }

    return { run_id, stage, events };
}

// ============================================================
// Helpers
// ============================================================

/**
 * Resolve a task slug from index notation (#1, #2) or partial match.
 * @param {string} projectSlug
 * @param {string} taskIdentifier
 * @returns {Promise<string>}
 */
async function resolveTaskSlug(projectSlug, taskIdentifier) {
    if (!taskIdentifier) {
        throw new Error('Task identifier required');
    }

    // Index notation: #1, #2, etc.
    if (taskIdentifier.startsWith('#')) {
        const idx = parseInt(taskIdentifier.slice(1), 10) - 1;
        const index = await storage.readProjectIndex(projectSlug);
        if (idx < 0 || idx >= index.tasks.length) {
            throw new Error(`Invalid task index: ${taskIdentifier}`);
        }
        return index.tasks[idx].task_slug;
    }

    // Direct slug
    return taskIdentifier;
}

/**
 * Format a relative time string.
 * @param {string} isoTime
 * @returns {string}
 */
function formatRelativeTime(isoTime) {
    if (!isoTime) return 'unknown';

    const ms = Date.now() - new Date(isoTime).getTime();
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
}

// ============================================================
// Exports
// ============================================================

module.exports = {
    // Project detection
    detectProject,
    ensureProject,

    // CLI commands
    cmdNew,
    cmdTasks,
    cmdShow,
    cmdRuns,
    cmdComplete,
    cmdGc,
    cmdRun,
    cmdUnlock,
    cmdTail,

    // Helpers
    resolveTaskSlug,
    formatRelativeTime,
};
