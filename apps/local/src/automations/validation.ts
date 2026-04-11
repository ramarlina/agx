import { CronExpressionParser } from "cron-parser";

import { parseNaturalSchedule } from "@/src/graph/nl-schedule";

import {
  DEFAULT_CANCEL_CHECK_SEC,
  DEFAULT_CATCH_UP_POLICY,
  DEFAULT_CONDITION_CHECK_EVERY_MS,
  DEFAULT_OVERLAP_POLICY,
  type AutomationDefinition,
  type AutomationExecution,
  type AutomationState,
  type AutomationTarget,
  type AutomationTrigger,
  type ConditionAutomationTrigger,
  type ExecutionGraphAutomationTarget,
  type PromptJobAutomationTarget,
  type ScheduledAutomationTrigger,
} from "./types";

function asTrimmedString(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .map((item) => asTrimmedString(item))
    .filter((item): item is string => Boolean(item));
  return items.length > 0 ? items : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function isValidIsoTimestamp(value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

function normalizeState(value: unknown): AutomationState {
  if (value === "active" || value === "paused" || value === "stopped") {
    return value;
  }
  throw new Error('Automation state must be one of "active", "paused", or "stopped".');
}

function validateCronExpr(expr: string): void {
  try {
    CronExpressionParser.parse(expr);
  } catch {
    throw new Error(`Invalid cron expression: "${expr}"`);
  }
}

function normalizeScheduledTrigger(value: unknown): ScheduledAutomationTrigger {
  const raw = asRecord(value);
  const cadence = asTrimmedString(raw.cadence);
  let cronExpr = asTrimmedString(raw.cronExpr);
  let intervalMs = asPositiveInteger(raw.intervalMs);

  if (!cronExpr && cadence) {
    try {
      validateCronExpr(cadence);
      cronExpr = cadence;
    } catch {
      const parsed = parseNaturalSchedule(cadence);
      if (!parsed) {
        throw new Error(`Could not parse schedule cadence: "${cadence}"`);
      }

      if (parsed.intervalMs && parsed.intervalMs < 60_000) {
        intervalMs = parsed.intervalMs;
      } else if (parsed.cronExpr) {
        cronExpr = parsed.cronExpr;
      }
    }
  }

  if (!cronExpr && !cadence && intervalMs === undefined) {
    throw new Error("Scheduled trigger requires at least one of cronExpr, cadence, or intervalMs.");
  }

  if (cronExpr) {
    validateCronExpr(cronExpr);
  }

  return {
    type: "scheduled",
    ...(cadence ? { cadence } : {}),
    ...(cronExpr ? { cronExpr } : {}),
    ...(intervalMs !== undefined ? { intervalMs } : {}),
  };
}

function normalizeConditionTrigger(value: unknown): ConditionAutomationTrigger {
  const raw = asRecord(value);
  const condition = asTrimmedString(raw.condition);
  const checkEveryMs = asPositiveInteger(raw.checkEveryMs) ?? DEFAULT_CONDITION_CHECK_EVERY_MS;

  if (!condition) {
    throw new Error("Condition trigger requires a non-empty condition.");
  }

  if (checkEveryMs < 60_000) {
    throw new Error("Condition trigger requires checkEveryMs >= 60000.");
  }

  return {
    type: "condition",
    condition,
    checkEveryMs,
  };
}

function normalizeTrigger(value: unknown): AutomationTrigger {
  const raw = asRecord(value);
  if (raw.type !== "scheduled" && raw.type !== "condition") {
    throw new Error('Automation trigger.type must be "scheduled" or "condition".');
  }
  const type = raw.type;
  return type === "condition"
    ? normalizeConditionTrigger(raw)
    : normalizeScheduledTrigger(raw);
}

function normalizeExecution(value: unknown): AutomationExecution | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const raw = asRecord(value);
  const execution: AutomationExecution = {};

  if (raw.overlapPolicy === "skip" || raw.overlapPolicy === "queue" || raw.overlapPolicy === "allow") {
    execution.overlapPolicy = raw.overlapPolicy;
  }
  if (
    raw.catchUpPolicy === "fire_once"
    || raw.catchUpPolicy === "replay_all"
    || raw.catchUpPolicy === "skip"
  ) {
    execution.catchUpPolicy = raw.catchUpPolicy;
  }

  const cancelCheckSec = asPositiveInteger(raw.cancelCheckSec);
  if (cancelCheckSec !== undefined) {
    if (cancelCheckSec < 1) {
      throw new Error("execution.cancelCheckSec must be >= 1.");
    }
    execution.cancelCheckSec = cancelCheckSec;
  }

  const condition = asTrimmedString(raw.condition);
  if (condition) {
    execution.condition = condition;
  }

  const maxRuns = asPositiveInteger(raw.maxRuns);
  if (maxRuns !== undefined) {
    execution.maxRuns = maxRuns;
  }

  const maxConsecutiveFailures = asPositiveInteger(raw.maxConsecutiveFailures);
  if (maxConsecutiveFailures !== undefined) {
    execution.maxConsecutiveFailures = maxConsecutiveFailures;
  }

  const activeUntil = asTrimmedString(raw.activeUntil);
  if (activeUntil) {
    if (!isValidIsoTimestamp(activeUntil)) {
      throw new Error(`Invalid execution.activeUntil timestamp: "${activeUntil}"`);
    }
    execution.activeUntil = new Date(activeUntil).toISOString();
  }

  return Object.keys(execution).length > 0 ? execution : undefined;
}

function normalizePromptTarget(value: unknown): PromptJobAutomationTarget {
  const raw = asRecord(value);
  const target: PromptJobAutomationTarget = { type: "prompt_job" };

  const agentId = asTrimmedString(raw.agentId);
  const provider = asTrimmedString(raw.provider);
  const model = asTrimmedString(raw.model);
  const cliArgs = asTrimmedString(raw.cliArgs);
  const prompt = typeof raw.prompt === "string" && raw.prompt.length > 0
    ? raw.prompt
    : undefined;
  const objectiveId = asTrimmedString(raw.objectiveId);
  const objectiveKey = asTrimmedString(raw.objectiveKey);

  if (!provider && !agentId) {
    throw new Error("Prompt-job target requires provider or agentId.");
  }

  if (agentId) target.agentId = agentId;
  if (provider) target.provider = provider;
  if (model) target.model = model;
  if (cliArgs !== undefined) target.cliArgs = cliArgs;
  if (prompt !== undefined) target.prompt = prompt;
  if (objectiveId) target.objectiveId = objectiveId;
  if (objectiveKey) target.objectiveKey = objectiveKey;
  return target;
}

function normalizeExecutionGraphTarget(value: unknown): ExecutionGraphAutomationTarget {
  const raw = asRecord(value);
  const graphId = asTrimmedString(raw.graphId);
  const taskId = asTrimmedString(raw.taskId);
  const resetNodeIds = asStringArray(raw.resetNodeIds);
  const rootMessageId = asTrimmedString(raw.rootMessageId);

  if (!graphId && !taskId) {
    throw new Error("Execution-graph target requires graphId or taskId.");
  }

  return {
    type: "execution_graph",
    ...(graphId ? { graphId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(resetNodeIds ? { resetNodeIds } : {}),
    ...(rootMessageId ? { rootMessageId } : {}),
  };
}

function normalizeTarget(value: unknown): AutomationTarget {
  const raw = asRecord(value);
  if (raw.type !== "prompt_job" && raw.type !== "execution_graph") {
    throw new Error('Automation target.type must be "prompt_job" or "execution_graph".');
  }
  return raw.type === "execution_graph"
    ? normalizeExecutionGraphTarget(raw)
    : normalizePromptTarget(raw);
}

export function resolvePromptFromDefinition(definition: AutomationDefinition): string | null {
  if (definition.target.type !== "prompt_job") {
    return null;
  }
  const body = typeof definition.body === "string" ? definition.body : "";
  if (body.trim().length > 0) {
    return body;
  }
  const targetPrompt = definition.target.prompt;
  return typeof targetPrompt === "string" && targetPrompt.length > 0
    ? targetPrompt
    : null;
}

export function normalizeAutomationDefinition(value: unknown): AutomationDefinition {
  const raw = asRecord(value);
  const id = asTrimmedString(raw.id);
  const name = asTrimmedString(raw.name);
  const description = asTrimmedString(raw.description);
  const projectId = asTrimmedString(raw.projectId);
  const createdAt = asTrimmedString(raw.createdAt);
  const body = typeof raw.body === "string" ? raw.body : "";

  if (!id) {
    throw new Error("Automation id is required.");
  }
  if (!name) {
    throw new Error("Automation name is required.");
  }
  if (createdAt && !isValidIsoTimestamp(createdAt)) {
    throw new Error(`Invalid createdAt timestamp: "${createdAt}"`);
  }

  const trigger = normalizeTrigger(raw.trigger);
  const execution = normalizeExecution(raw.execution);
  const target = normalizeTarget(raw.target);

  if (target.type === "prompt_job") {
    const prompt = resolvePromptFromDefinition({
      id,
      name,
      description,
      projectId,
      state: normalizeState(raw.state),
      trigger,
      execution,
      target,
      createdAt,
      body,
    });

    if (!prompt) {
      throw new Error("Prompt-job automation requires prompt text in body or target.prompt.");
    }

    const cancelCheckSec = execution?.cancelCheckSec ?? DEFAULT_CANCEL_CHECK_SEC;
    if (cancelCheckSec < 1) {
      throw new Error("Prompt-job execution.cancelCheckSec must be >= 1.");
    }
  }

  return {
    id,
    name,
    ...(description ? { description } : {}),
    ...(projectId ? { projectId } : {}),
    state: normalizeState(raw.state),
    trigger,
    ...(execution ? { execution } : {}),
    target,
    ...(createdAt ? { createdAt: new Date(createdAt).toISOString() } : {}),
    body,
  };
}

export function getExecutionWithDefaults(
  definition: AutomationDefinition,
): Required<Pick<AutomationExecution, "overlapPolicy" | "catchUpPolicy" | "cancelCheckSec">> & AutomationExecution {
  return {
    overlapPolicy: definition.execution?.overlapPolicy ?? DEFAULT_OVERLAP_POLICY,
    catchUpPolicy: definition.execution?.catchUpPolicy ?? DEFAULT_CATCH_UP_POLICY,
    cancelCheckSec: definition.execution?.cancelCheckSec ?? DEFAULT_CANCEL_CHECK_SEC,
    ...(definition.execution ?? {}),
  };
}
