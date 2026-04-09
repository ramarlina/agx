import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCHEDULED_TASK_SKILL_ID = "scheduled-task-manager";

type ScheduledTaskSkillOptions = {
  agxDataDir?: string;
  workspaceRoot?: string;
};

function toDisplayPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function resolveAgxDataDir(explicitDir?: string): string {
  const trimmed = explicitDir?.trim();
  if (trimmed) return trimmed;
  const configured = process.env.AGX_DATA_DIR?.trim();
  if (configured) return configured;
  return path.join(os.homedir(), ".agx");
}

function resolveWorkspaceRoot(explicitRoot?: string): string {
  const trimmed = explicitRoot?.trim();
  if (trimmed) return trimmed;
  return process.cwd();
}

export function getScheduledTaskSkillPath(options: ScheduledTaskSkillOptions = {}): string {
  return path.join(
    resolveAgxDataDir(options.agxDataDir),
    "skills",
    SCHEDULED_TASK_SKILL_ID,
    "SKILL.md",
  );
}

export function buildScheduledTaskSkillContent(options: ScheduledTaskSkillOptions = {}): string {
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const specPath = toDisplayPath(path.join(workspaceRoot, "planning", "automation-frontmatter-migration-spec.md"));
  const automationsDir = toDisplayPath(path.join(workspaceRoot, "src", "automations"));
  const promptSchedulerDir = toDisplayPath(path.join(workspaceRoot, "src", "prompt-scheduler"));
  const graphScheduleRunnerPath = toDisplayPath(path.join(workspaceRoot, "src", "graph", "schedule-runner.ts"));
  const graphStorePath = toDisplayPath(path.join(workspaceRoot, "src", "graph", "store.ts"));
  const automationsRoutePath = toDisplayPath(path.join(workspaceRoot, "app", "api", "automations", "route.ts"));
  const promptJobsRoutePath = toDisplayPath(path.join(workspaceRoot, "app", "api", "prompt-jobs", "route.ts"));

  return `---
name: scheduled-task-manager
description: Use when creating, editing, migrating, debugging, or reviewing AGX scheduled tasks, automations, prompt jobs, execution graph schedules, or frontmatter-backed automation definitions.
---

# Scheduled Task Manager

Use this skill whenever the task touches scheduled tasks, automations, prompt jobs, execution graph schedules, or automation frontmatter.

## Read First

- [automation-frontmatter-migration-spec](${specPath})
- Shared automation model lives in [src/automations](${automationsDir})
- Prompt-job scheduling lives in [src/prompt-scheduler](${promptSchedulerDir})
- Execution-graph scheduling flows through [schedule-runner.ts](${graphScheduleRunnerPath}) and [store.ts](${graphStorePath})
- API entry points are [app/api/automations/route.ts](${automationsRoutePath}) and [app/api/prompt-jobs/route.ts](${promptJobsRoutePath})

## Guardrails

- Reject malformed frontmatter. Do not coerce invalid enum values into defaults.
- Preserve stable automation ids. Renaming a task must not create a new id.
- Keep runtime state such as last run, next run, and archival flags out of frontmatter unless the spec explicitly says otherwise.
- Preserve sub-minute scheduled cadences when they are represented as \`intervalMs\`.
- For \`execution_graph\` targets, keep \`graphId\` and \`taskId\` resolution correct. Do not assume \`definition.id === taskId\`.
- Updating an automation definition should advance user-visible \`updatedAt\`.
- Avoid eager file-backed repository initialization on request paths that should stay lazy or rollout-gated.
- Keep parser and serializer behavior round-trippable unless the spec explicitly requires normalization.

## Working Pattern

1. Read the migration spec before changing storage, rollout, or validation behavior.
2. Trace the full path: parser -> validation -> repository -> scheduler -> API.
3. Add or update regression tests for parsing, serialization, due selection, and the affected API or runtime path.
4. Prefer small fixes in the shared automation layer over duplicating logic in adapters.

## Validation Checklist

- Scheduled triggers keep \`cronExpr\`, \`cadence\`, and sub-minute \`intervalMs\` semantics intact.
- Condition triggers validate required fields and reject unsupported polling intervals.
- Target-specific required fields are enforced.
- Invalid definitions fail closed and are excluded instead of silently rewritten.
- Prompt-job and execution-graph adapters preserve the same runtime meaning before and after frontmatter serialization.
`;
}

export function ensureScheduledTaskSkillInstalled(options: ScheduledTaskSkillOptions = {}): string {
  const skillPath = getScheduledTaskSkillPath(options);
  const skillContent = buildScheduledTaskSkillContent(options);

  try {
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    const existing = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, "utf8") : null;
    if (existing !== skillContent) {
      fs.writeFileSync(skillPath, skillContent, "utf8");
    }
  } catch (error) {
    console.warn("[scheduled-task-skill] Failed to install skill:", error);
  }

  return skillPath;
}

export function buildScheduledTaskSkillPromptContext(options: ScheduledTaskSkillOptions = {}): string {
  const skillPath = ensureScheduledTaskSkillInstalled(options);
  return [
    "<scheduled-task-skill>",
    `Path: ${toDisplayPath(skillPath)}`,
    "Read this skill whenever the task involves scheduled tasks, automations, prompt jobs, execution graph schedules, or frontmatter-backed automation definitions.",
    "</scheduled-task-skill>",
  ].join("\n");
}
