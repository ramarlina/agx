/**
 * Budgeted prompt assembly for agx local state storage.
 * 
 * Builds prompts from canonical state with per-section caps.
 * Never auto-injects historical logs.
 */

const { readTaskState, readWorkingSet, readApprovals, readLastRun } = require('./state');
const { readDecision } = require('./runs');
const { promptBuiltEvent } = require('./events');

// ============================================================
// Default Budgets (in chars)
// ============================================================

const DEFAULT_BUDGETS = {
    rules: 2000,
    task_essentials: 2000,
    working_set: 4000,
    last_decision: 1500,
    repo_context: 4000,
    error_excerpt: 1500,
};

// ============================================================
// Prompt Builder
// ============================================================

/**
 * @typedef {object} PromptSection
 * @property {string} name
 * @property {string} content
 * @property {number} bytes
 */

/**
 * @typedef {object} BuiltPrompt
 * @property {string} promptText
 * @property {PromptSection[]} sections
 * @property {object} sizes - Per-section byte counts
 * @property {number} totalBytes
 * @property {object} event - PROMPT_BUILT event for logging
 */

/**
 * Build a budgeted prompt from canonical state.
 * @param {object} params
 * @param {string} params.projectSlug
 * @param {string} params.taskSlug
 * @param {string} [params.rules] - System rules/instructions
 * @param {string} [params.repoContext] - Repository context excerpt
 * @param {string} [params.errorExcerpt] - Error excerpt if applicable
 * @param {object} [params.budgets] - Override default budgets
 * @returns {Promise<BuiltPrompt>}
 */
async function buildPrompt({ projectSlug, taskSlug, rules, repoContext, errorExcerpt, budgets = {} }) {
    const effectiveBudgets = { ...DEFAULT_BUDGETS, ...budgets };

    // Load canonical state
    const [taskState, workingSet, approvals, lastRun] = await Promise.all([
        readTaskState(projectSlug, taskSlug),
        readWorkingSet(projectSlug, taskSlug),
        readApprovals(projectSlug, taskSlug),
        readLastRun(projectSlug, taskSlug),
    ]);

    if (!taskState) {
        throw new Error(`Task ${taskSlug} not found in project ${projectSlug}`);
    }

    // Load last decision if available
    let lastDecision = null;
    if (lastRun.overall) {
        lastDecision = await readDecision(
            projectSlug,
            taskSlug,
            lastRun.overall.stage,
            lastRun.overall.run_id
        );
    }

    /** @type {PromptSection[]} */
    const sections = [];

    // 1. Rules/Instructions
    if (rules) {
        sections.push(buildSection('rules', rules, effectiveBudgets.rules));
    }

    // 2. Task Essentials
    const taskEssentials = buildTaskEssentials(taskState);
    sections.push(buildSection('task_essentials', taskEssentials, effectiveBudgets.task_essentials));

    // 3. Working Set
    if (workingSet) {
        sections.push(buildSection('working_set', workingSet, effectiveBudgets.working_set));
    }

    // 4. Last Decision Summary
    if (lastDecision) {
        const decisionSummary = buildDecisionSummary(lastDecision);
        sections.push(buildSection('last_decision', decisionSummary, effectiveBudgets.last_decision));
    }

    // 5. Approvals Status
    if (approvals.pending.length > 0) {
        const approvalsSummary = buildApprovalsSummary(approvals);
        sections.push(buildSection('approvals', approvalsSummary, 500));
    }

    // 6. Repo Context (optional)
    if (repoContext) {
        sections.push(buildSection('repo_context', repoContext, effectiveBudgets.repo_context));
    }

    // 7. Error Excerpt (optional)
    if (errorExcerpt) {
        sections.push(buildSection('error_excerpt', errorExcerpt, effectiveBudgets.error_excerpt));
    }

    // Assemble prompt
    const promptParts = sections.map(s => {
        const header = sectionHeader(s.name);
        return `${header}\n\n${s.content}`;
    });

    const promptText = promptParts.join('\n\n---\n\n');

    // Calculate sizes
    const sizes = {};
    for (const section of sections) {
        sizes[section.name] = section.bytes;
    }

    const totalBytes = Buffer.byteLength(promptText, 'utf8');

    // Create event for logging
    const event = promptBuiltEvent({ sections: sizes, total_bytes: totalBytes });

    return {
        promptText,
        sections,
        sizes,
        totalBytes,
        event,
    };
}

/**
 * Build task essentials section from task state.
 * @param {object} taskState
 * @returns {string}
 */
function buildTaskEssentials(taskState) {
    const parts = [
        '## User Request',
        '',
        taskState.user_request,
        '',
        '## Goal',
        '',
        taskState.goal,
    ];

    if (taskState.criteria && taskState.criteria.length > 0) {
        parts.push('', '## Criteria', '');
        for (const criterion of taskState.criteria) {
            parts.push(`- ${criterion}`);
        }
    }

    parts.push('', `**Status:** ${taskState.status}`);

    return parts.join('\n');
}

/**
 * Build a summary of the last decision.
 * @param {object} decision
 * @returns {string}
 */
function buildDecisionSummary(decision) {
    if (!decision) {
        return '';
    }

    const parts = [
        `**Last Run Status:** ${decision.status}`,
    ];

    if (decision.reason) {
        parts.push('', `**Reason:** ${decision.reason}`);
    }

    if (decision.next_actions && decision.next_actions.length > 0) {
        parts.push('', '**Next Actions:**');
        for (const action of decision.next_actions) {
            parts.push(`- [${action.type}] ${action.summary}`);
        }
    }

    if (decision.criteria_progress) {
        if (decision.criteria_progress.done?.length > 0) {
            parts.push('', '**Completed Criteria:**');
            for (const c of decision.criteria_progress.done) {
                parts.push(`- ✓ ${c}`);
            }
        }
        if (decision.criteria_progress.pending?.length > 0) {
            parts.push('', '**Pending Criteria:**');
            for (const c of decision.criteria_progress.pending) {
                parts.push(`- ○ ${c}`);
            }
        }
    }

    return parts.join('\n');
}

/**
 * Build approvals status summary.
 * @param {object} approvals
 * @returns {string}
 */
function buildApprovalsSummary(approvals) {
    if (!approvals || !approvals.pending || approvals.pending.length === 0) {
        return '';
    }

    const parts = ['**Pending Approvals:**', ''];

    for (const req of approvals.pending) {
        parts.push(`- [${req.id}] ${req.action}`);
        if (req.reason) {
            parts.push(`  Reason: ${req.reason}`);
        }
    }

    return parts.join('\n');
}

// ============================================================
// Helpers
// ============================================================

/**
 * Build a section with budget enforcement.
 * @param {string} name
 * @param {string} content
 * @param {number} maxChars
 * @returns {PromptSection}
 */
function buildSection(name, content, maxChars) {
    let finalContent = content;

    if (content.length > maxChars) {
        // Truncate with marker
        finalContent = content.slice(0, maxChars - 50) + '\n\n<!-- content truncated -->';
    }

    return {
        name,
        content: finalContent,
        bytes: Buffer.byteLength(finalContent, 'utf8'),
    };
}

/**
 * Generate a section header.
 * @param {string} name
 * @returns {string}
 */
function sectionHeader(name) {
    const titleMap = {
        rules: '# Rules & Instructions',
        task_essentials: '# Task',
        working_set: '# Working Set',
        last_decision: '# Last Run Summary',
        approvals: '# Approvals',
        repo_context: '# Repository Context',
        error_excerpt: '# Error Details',
    };

    return titleMap[name] || `# ${name}`;
}

/**
 * Estimate token count (rough approximation).
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
    if (!text) {
        return 0;
    }
    // Rough heuristic: ~4 chars per token for English
    return Math.ceil(text.length / 4);
}

// ============================================================
// Exports
// ============================================================

module.exports = {
    DEFAULT_BUDGETS,
    buildPrompt,
    buildTaskEssentials,
    buildDecisionSummary,
    buildApprovalsSummary,
    estimateTokens,
};
