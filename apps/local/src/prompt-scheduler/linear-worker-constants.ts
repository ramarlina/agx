export const LINEAR_WORKER_JOB_NAME = 'Linear worker';
export const LINEAR_WORKER_DEFAULT_CADENCE = 'every 30 minutes';

/**
 * Default selection prompt — guides the controller LLM when picking which ticket to work on.
 */
export const LINEAR_WORKER_DEFAULT_PROMPT = `Pick the highest-priority actionable ticket. Prefer tickets that:
1. Are already started (existing branches, PRs, or prior comments) — continue where you left off.
2. Are assigned to you or unassigned.
3. Have the most urgent priority or earliest due date.

Skip tickets with the \`active-session\` label — another agent is already working on them.`;

/**
 * Default execution prompt — injected into the agent chat session when working a selected ticket.
 * When empty, the system falls back to the built-in linear execution prompt (buildLinearExecutionPrompt).
 * Supports template variables: {{ticket.identifier}}, {{ticket.title}}, {{ticket.status}},
 * {{ticket.assignee}}, {{project.name}}, {{project.slug}}, {{knowledge_base.root}},
 * {{knowledge_base.issue_path}}, {{worktree.path}}.
 */
export const LINEAR_WORKER_DEFAULT_SCRIPT_PROMPT = `Work on {{ticket.identifier}}: {{ticket.title}}

## Workflow

1. **Read the ticket** — Read the full issue and comment thread via Linear MCP before acting.
2. **Resume existing work** — Check for existing branches, PRs, knowledge-base notes, or prior discussion. Continue where things left off.
3. **If unclear** — Post a clarifying comment on the ticket and stop. Don't guess.
4. **If fresh** — Investigate the codebase, draft a plan, post it as a comment. Stop and wait for approval.
5. **If plan is approved** — Create a git worktree, implement the fix, run tests, commit, push, and create a PR linking the ticket.
6. **If PR exists** — Check CI, address review feedback, or confirm merge. Don't start over.

## Rules

- Work in an isolated git worktree — never modify the main checkout directly.
- Keep Linear accurate: update status, post comments, link PRs.
- Add the \`active-session\` label when starting. Remove it when done.
- Leave everything in a resumable state. Clean up worktrees when finished.
- One ticket per session.`;
