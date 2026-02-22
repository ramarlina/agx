'use strict';

/**
 * Centralized prompt templates for agx.
 *
 * All prompt string content lives here. Builder functions that assemble
 * conditional logic stay in their original files and import these templates.
 *
 * Use `interpolate(template, vars)` to fill `{{key}}` placeholders.
 */

function interpolate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

// ---------------------------------------------------------------------------
// Static templates (no variables)
// ---------------------------------------------------------------------------

const DEFAULT_STAGE_PROMPT = 'Carry out this scope using the latest objective from the cloud task context.';

const PROJECT_CONTEXT = [
  'AGX orchestrates autonomous AI agents with tasks defined via `agx new` and managed through `agx run`, `agx tasks`, `agx status`, and `agx context` so agents can wake, work, and sleep across sessions.',
  'Task state lives in the cloud API (goal, criteria, progress, learnings) along with the orchestration worker (pg-boss); `agx info`/`agx context` expose structured project metadata.',
  'Quick-start workflow: `agx new "<goal>"`, optionally `agx -a -p "<goal>"` for autonomous operation, then use `agx run`, `agx tasks`, `agx status`, and `agx context` to manage work.',
  'Task management commands include `agx task ls`, `agx task logs`, `agx task stop`, `agx task rm`, `agx complete`, `agx pull`.',
  'Daemon mode runs via `agx daemon start/stop/status/logs` so agents can poll for work continuously.',
  'Providers: `agx claude` (alias `c`), `agx gemini` (alias `g`), and `agx ollama` (alias `o`).',
  'Key flags: `-a/--autonomous`, `-p/--prompt`, `--prompt-file`, `-y/--yolo`, `--continue <task>`.',
  'Key principles: persistent storage, criteria-driven completion, checkpoint often, ask when stuck, learn and adapt.',
  'Agent workflow: orient on saved state, outline, implement, checkpoint, adapt to blockers, and report learnings.',
  'State operations: define objectives via `agx new`, update learnings with `[learn: ...]`, mark completion via `agx complete`, and sync via `agx info`/`agx context`.',
  'Project metadata: attach `--metadata key=value` and `--repo` info so `/api/projects` keeps structured context.',
].join('\n');

const AGX_SKILL = `---
name: agx
description: Task orchestrator for AI agents. Uses cloud API for persistence.
---

# agx - AI Agent Task Orchestrator

agx manages tasks and coordinates AI agents. Uses cloud API for persistence.

## Quick Start

\`\`\`bash
agx -a -p "Build a REST API"  # Autonomous: works until done
agx -p "explain this code"     # One-shot question
\`\`\`

## Task Lifecycle

\`\`\`bash
agx new "goal"          # Create task
agx run [task]          # Run a task
agx complete <taskId>   # Mark task stage complete
agx status <taskId>     # Show detailed info for a specific task
agx status              # Show current status
\`\`\`

## Task Dependencies (ordering)

\`\`\`bash
agx new "Task C" --depends-on <taskA-id> --depends-on <taskB-id>
agx deps <task-c>                                  # Show depends_on + dependents
agx deps <task-c> --depends-on <taskA> --depends-on <taskB>  # Set dependencies
agx deps <task-c> --clear                          # Remove all dependencies
\`\`\`

Use task UUIDs, slugs, or \`agx task ls\` index references.

## Checking Tasks

\`\`\`bash
agx task ls             # List tasks
agx task logs <id> [-f] # View/tail task logs
agx task tail <id>      # Tail task logs
agx comments tail <id>  # Tail task comments
agx logs tail <id>      # Tail task logs
agx watch               # Watch task updates in real-time (SSE)
\`\`\`

## Cloud

\`\`\`bash
AGX_CLOUD_URL=http://localhost:41741 agx status
AGX_CLOUD_URL=http://localhost:41741 agx task ls
agx daemon start  # Start local daemon
\`\`\`

## Providers

claude (c), gemini (g), ollama (o), codex (x)

## Key Flags

-a  Autonomous mode (daemon + work until done)
-p  Prompt/goal
-y  Skip confirmations (implied by -a)
-P, --provider <c|g|o|x>  Provider for new task (claude/gemini/ollama/codex)
`;

// ---------------------------------------------------------------------------
// Parameterized templates (use with interpolate())
// ---------------------------------------------------------------------------

const CONTINUE_CLOUD_TASK = `## Cloud Task Context

You are continuing a cloud task. Here is the current state:

Task ID: {{id}}
Title: {{title}}
Stage: {{stage}}
Stage Objective: {{stagePrompt}}
Stage Completion Requirement: {{stageRequirement}}

\tUser Request: 
\t"""
\t{{taskTitle}}
\t{{taskContent}}
\t---
\tTask Thread:
\t{{taskComments}}
\t"""

## Extracted State

Goal: {{goal}}
Plan: {{plan}}
Todo: {{todo}}
Checkpoints: {{checkpoints}}
Learnings: {{learnings}}

`;

const NEW_AUTONOMOUS_CLOUD_TASK = `## Cloud Task Context

\tTask ID: {{id}}
\tTitle: {{title}}
\tStage: {{stage}}
\tStage Objective: {{stagePrompt}}
\tStage Completion Requirement: {{stageRequirement}}

\tUser Request: 
\t"""
\t{{taskTitle}}
\t{{taskContent}}
\t---
\tTask Thread:
\t{{taskComments}}
\t"""

---

## Instructions

You are starting a new autonomous task. Work until completion or blocked.
Respect the Stage Completion Requirement before using [complete] or [done].

To update the task:
- [done] - Mark task complete
- [complete: message] - Complete current stage
- [log: message] - Add a log entry

Goal: {{finalPrompt}}
`;

const LEGACY_INSTRUCTION_FOOTER = `## Instructions

Continue working on this task. Use the cloud API to sync progress.
Respect the Stage Completion Requirement before using [complete] or [done].

Follow-up work policy:
- If you identify follow-up tasks, create them in AGX via CLI ("agx new") and include the owning project id using "--project <project_id>".
- Do not leave follow-up work only as local ticket/markdown notes.

{{runPaths}}

To update the task:
- [done] - Mark task complete
- [complete: message] - Complete current stage
- [log: message] - Add a log entry
- [checkpoint: message] - Save progress checkpoint
- [learn: insight] - Record a learning
- [plan: text] - Update plan
- [todo: text] - Update todo list

{{finalPrompt}}`;

const AGGREGATOR_PROMPT = `You are the decision aggregator for a {{role}} run.

Task ID: {{taskId}}
Title: {{title}}
Stage: {{stage}}

User Request: 
"""
{{taskTitle}}
{{taskContent}}
---
Task Thread:
{{taskComments}}
"""

Stage Objective: {{stagePrompt}}
Stage Completion Requirement: {{stageRequirement}}

Local run artifacts folder: {{runRoot}}
Key run files:
{{runFiles}}

Relevant files referenced during recent runs (detected from output/logs):
{{refsBlock}}

Decide if the task is done. If not, provide the next instruction for another iteration.
Only set "done": true when the Stage Completion Requirement is satisfied.

You may think through your analysis first, but you MUST end your response with valid JSON.

Output contract (strict):
- You may include thinking/reasoning at the start of your response
- Your response MUST end with exactly one raw JSON object
- Do not use markdown/code fences/backticks around the JSON
- Do not add commentary after the JSON
- Use double-quoted keys and strings
- Keep newlines escaped inside strings
- If "done" is false, "next_prompt" must be a non-empty actionable instruction

The final JSON in your response must have this exact shape:
{
  "done": false,
  "decision": "done|blocked|not_done|failed",
  "explanation": "clear explanation of the decision",
  "final_result": "final result if done, empty string otherwise",
  "next_prompt": "specific actionable instruction for next iteration",
  "summary": "brief summary of current state"
}

If uncertain, still return valid JSON with decision "failed" and explain why in "explanation".
`;

const EXECUTE_ITERATION = `WORK PHASE
Iteration: {{iteration}}

Keep output concise and avoid dumping full file contents or long logs.
If you need to reference code, cite paths and describe changes instead of pasting whole files.

Output contract:
- Start with "PLAN:" then 2-5 bullets.
- Do the work.
- End with "IMPLEMENTATION SUMMARY:" bullets:
  - Changed: (paths only, 10 max)
  - Commands: (what you ran)
  - Notes:

Task for this iteration: {{instruction}}

Do not output JSON in this phase.
`;

const VERIFY_PROMPT = `You are the validator for an agx run.

Task ID: {{taskId}}
Title: {{title}}
Stage: {{stage}}
Iteration: {{iteration}}

Stage Objective: {{stagePrompt}}
Stage Completion Requirement: {{stageRequirement}}

Local run artifacts folder: {{runRoot}}

User Request: 
"""
{{requestTitle}}
{{requestContent}}
"""

## Validation Strategy

Your job is to determine whether the user request is actually satisfied in the codebase. Do NOT rely solely on git status/diff or agent output summaries — these can be misleading, incomplete, or refer to the wrong workspace.

Follow this approach:

1. **Understand the request.** What concrete outcome does the user want? (e.g., a function wired to an endpoint, a new component, a bug fix)

2. **Read the actual source files.** Identify the key files that should contain the implementation and read them directly. Look for the specific functions, imports, routes, or components that the request describes. This is the primary evidence.

3. **Check validation command output.** If tests or build commands were run, use their results as supporting evidence — but only after you've confirmed the implementation exists in the source.

4. **Use git status/diff as secondary context.** Diff tells you what changed this iteration, but the feature may have been implemented in a prior iteration or already existed. Absence of a diff does NOT mean the work is incomplete.

5. **Trace the full path.** For wiring tasks, confirm both ends: the data source (API helper, service function) AND the consumer (page, component, hook). For bug fixes, confirm the fix AND that the triggering condition is handled.

Repo summary (git):
Status (porcelain):
{{statusShort}}

Diff (stat):
{{diffShort}}

Validation commands:
{{cmdLines}}

Agent output (last iteration):
{{agentOutputShort}}

Decide if the stage is complete based on what you find in the source files.
Ignore unrelated working tree changes; focus on whether the user request is satisfied.
If not complete, provide the next smallest instruction for another iteration.
Set "done": true when the user request is satisfied and the source code evidence supports it.

Output contract (strict): your response MUST be exactly one raw JSON object with this shape:
{
  "done": false,
  "decision": "done|blocked|not_done|failed",
  "explanation": "clear explanation of the decision",
  "final_result": "final result if done, empty string otherwise",
  "next_prompt": "specific actionable instruction for next iteration",
  "summary": "brief summary of current state",
  "plan_md": "PLAN markdown for this iteration (newlines escaped)",
  "implementation_summary_md": "IMPLEMENTATION SUMMARY markdown (newlines escaped)",
  "validation_md": "VALIDATION markdown (newlines escaped)"
}

Rules:
- Use double-quoted keys and strings.
- Keep newlines escaped inside strings (use \\n).
- Keep the markdown fields short and checklist-style.
- Always fill "explanation". For "blocked", include what is blocking and what input/action would unblock. For "failed", include what failed (command/tool/error) and a recovery step.
`;

const EXECUTOR_PROMPT = `# Task: {{title}}

## Stage: {{stage}}

{{stagePrompt}}

## Project Context

{{projectContext}}

## Task Details

{{content}}

## Instructions

1. Complete the work for this stage
2. Use [checkpoint: message] to save progress
3. Use [learn: insight] to record learnings
4. Use [done] when stage is complete
5. Use [blocked: reason] if you need human help
6. If follow-up tasks are needed, create them with "agx new --project <project_id>" instead of only writing them to local ticket files.

Focus on this stage only. The task will automatically advance to the next stage when complete.
`;

module.exports = {
  interpolate,
  DEFAULT_STAGE_PROMPT,
  PROJECT_CONTEXT,
  AGX_SKILL,
  CONTINUE_CLOUD_TASK,
  NEW_AUTONOMOUS_CLOUD_TASK,
  LEGACY_INSTRUCTION_FOOTER,
  AGGREGATOR_PROMPT,
  EXECUTE_ITERATION,
  VERIFY_PROMPT,
  EXECUTOR_PROMPT,
};
