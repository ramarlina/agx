import type { GraphSchedule } from "@/src/graph/types";
import type { PromptJob } from "@/src/prompt-scheduler/types";
import {
  formatIntervalCadence,
  normalizeLegacyConditionSchedule,
} from "@/src/prompt-scheduler/cron";

import {
  DEFAULT_CANCEL_CHECK_SEC,
  DEFAULT_CATCH_UP_POLICY,
  DEFAULT_GRAPH_INTERVAL_MS,
  DEFAULT_OVERLAP_POLICY,
  type AutomationDefinition,
  type AutomationRecord,
  type AutomationRuntimeState,
  type LegacyGraphAutomationRow,
  type LegacyPromptJobLike,
} from "./types";
import { initializeAutomationRuntimeState } from "./state";
import { getExecutionWithDefaults, resolvePromptFromDefinition } from "./validation";

export function automationRecordToPromptJob(record: AutomationRecord): PromptJob {
  if (record.definition.target.type !== "prompt_job") {
    throw new Error(`Automation ${record.definition.id} is not a prompt-job automation.`);
  }

  const trigger = record.definition.trigger;
  const execution = getExecutionWithDefaults(record.definition);
  const prompt = resolvePromptFromDefinition(record.definition) ?? "";
  const legacySchedule = trigger.type === "condition"
    ? normalizeLegacyConditionSchedule(trigger.checkEveryMs)
    : null;

  return {
    id: record.definition.id,
    name: record.definition.name,
    prompt,
    agentId: record.definition.target.agentId ?? "",
    projectId: record.definition.projectId ?? "",
    objectiveId: record.definition.target.objectiveId ?? null,
    objectiveKey: record.definition.target.objectiveKey ?? null,
    provider: record.definition.target.provider ?? "claude",
    model: record.definition.target.model ?? "",
    cliArgs: record.definition.target.cliArgs ?? "",
    cronExpr: trigger.type === "scheduled"
      ? trigger.cronExpr ?? ""
      : legacySchedule?.cronExpr ?? "",
    cadence: trigger.type === "scheduled"
      ? trigger.cadence ?? trigger.cronExpr ?? ""
      : legacySchedule?.cadence ?? formatIntervalCadence(trigger.checkEveryMs),
    state: record.definition.state,
    overlapPolicy: execution.overlapPolicy,
    catchUpPolicy: execution.catchUpPolicy,
    cancelCheckSec: execution.cancelCheckSec,
    condition: execution.condition ?? (trigger.type === "condition" ? trigger.condition : ""),
    nextRunAt: record.runtimeState.nextRunAt ?? null,
    lastRunAt: record.runtimeState.lastRunAt ?? null,
    lastOutcome: (record.runtimeState.lastOutcome ?? null) as PromptJob["lastOutcome"],
    createdAt: record.definition.createdAt ?? record.runtimeState.updatedAt,
    updatedAt: record.runtimeState.updatedAt,
  };
}

export function promptJobToAutomationDefinition(job: LegacyPromptJobLike): AutomationDefinition {
  return {
    id: job.id,
    name: job.name,
    ...(job.projectId ? { projectId: job.projectId } : {}),
    state: job.state,
    trigger: {
      type: "scheduled",
      ...(job.cadence ? { cadence: job.cadence } : {}),
      ...(job.cronExpr ? { cronExpr: job.cronExpr } : {}),
    },
    execution: {
      overlapPolicy: job.overlapPolicy,
      catchUpPolicy: job.catchUpPolicy,
      cancelCheckSec: job.cancelCheckSec,
      ...(job.condition ? { condition: job.condition } : {}),
    },
    target: {
      type: "prompt_job",
      ...(job.agentId ? { agentId: job.agentId } : {}),
      ...(job.provider ? { provider: job.provider } : {}),
      ...(job.model ? { model: job.model } : {}),
      ...(job.cliArgs ? { cliArgs: job.cliArgs } : {}),
      ...(job.objectiveId ? { objectiveId: job.objectiveId } : {}),
      ...(job.objectiveKey ? { objectiveKey: job.objectiveKey } : {}),
    },
    createdAt: job.createdAt,
    body: job.prompt,
  };
}

export function promptJobToAutomationRuntimeState(job: LegacyPromptJobLike): AutomationRuntimeState {
  return initializeAutomationRuntimeState(promptJobToAutomationDefinition(job), {
    nextRunAt: job.nextRunAt,
    lastRunAt: job.lastRunAt,
    lastOutcome: job.lastOutcome,
    updatedAt: job.updatedAt,
  });
}

export function automationRecordToGraphSchedule(
  record: AutomationRecord,
  fallback: Partial<GraphSchedule> = {},
): GraphSchedule {
  if (record.definition.target.type !== "execution_graph") {
    throw new Error(`Automation ${record.definition.id} is not a graph automation.`);
  }

  const trigger = record.definition.trigger;
  const execution = record.definition.execution;
  const intervalMs = trigger.type === "condition"
    ? trigger.checkEveryMs
    : trigger.intervalMs ?? fallback.intervalMs ?? DEFAULT_GRAPH_INTERVAL_MS;

  return {
    intervalMs,
    ...(trigger.type === "scheduled" && trigger.cronExpr ? { cronExpr: trigger.cronExpr } : {}),
    ...(trigger.type === "scheduled" && trigger.cadence ? { cadence: trigger.cadence } : {}),
    ...(trigger.type === "condition" ? { cadence: trigger.condition } : {}),
    state: record.definition.state,
    resetNodeIds: record.definition.target.resetNodeIds ?? fallback.resetNodeIds ?? [],
    ...(execution?.maxRuns !== undefined ? { maxRuns: execution.maxRuns } : {}),
    runCount: record.runtimeState.runCount ?? fallback.runCount ?? 0,
    ...(record.runtimeState.lastRunAt !== null && record.runtimeState.lastRunAt !== undefined
      ? { lastTickAt: record.runtimeState.lastRunAt }
      : fallback.lastTickAt !== undefined
        ? { lastTickAt: fallback.lastTickAt }
        : {}),
    ...(record.runtimeState.nextRunAt !== null && record.runtimeState.nextRunAt !== undefined
      ? { nextTickAt: record.runtimeState.nextRunAt }
      : fallback.nextTickAt !== undefined
        ? { nextTickAt: fallback.nextTickAt }
        : {}),
    tickInProgress: record.runtimeState.tickInProgress ?? fallback.tickInProgress ?? false,
    createdAt: record.definition.createdAt ?? fallback.createdAt ?? new Date().toISOString(),
    ...(execution?.activeUntil ? { activeUntil: execution.activeUntil } : {}),
    ...(record.definition.target.rootMessageId
      ? { rootMessageId: record.definition.target.rootMessageId }
      : fallback.rootMessageId
        ? { rootMessageId: fallback.rootMessageId }
        : {}),
    ...(record.runtimeState.consecutiveFailures !== undefined
      ? { consecutiveFailures: record.runtimeState.consecutiveFailures }
      : fallback.consecutiveFailures !== undefined
        ? { consecutiveFailures: fallback.consecutiveFailures }
        : {}),
    ...(execution?.maxConsecutiveFailures !== undefined
      ? { maxConsecutiveFailures: execution.maxConsecutiveFailures }
      : fallback.maxConsecutiveFailures !== undefined
        ? { maxConsecutiveFailures: fallback.maxConsecutiveFailures }
        : {}),
    name: record.definition.name,
    ...(record.definition.description ? { description: record.definition.description } : {}),
  };
}

export function graphAutomationToDefinition(row: LegacyGraphAutomationRow): AutomationDefinition {
  const { schedule } = row;
  const trigger = schedule.cronExpr || schedule.cadence
    ? {
      type: "scheduled" as const,
      ...(schedule.cadence ? { cadence: schedule.cadence } : {}),
      ...(schedule.cronExpr ? { cronExpr: schedule.cronExpr } : {}),
    }
    : {
      type: "scheduled" as const,
      cadence: formatIntervalCadence(schedule.intervalMs),
      intervalMs: schedule.intervalMs,
    };

  return {
    id: row.graphId,
    name: schedule.name?.trim() || row.graphId,
    ...(schedule.description ? { description: schedule.description } : {}),
    state: schedule.state,
    trigger,
    execution: {
      overlapPolicy: DEFAULT_OVERLAP_POLICY,
      catchUpPolicy: DEFAULT_CATCH_UP_POLICY,
      cancelCheckSec: DEFAULT_CANCEL_CHECK_SEC,
      ...(schedule.maxRuns !== undefined ? { maxRuns: schedule.maxRuns } : {}),
      ...(schedule.maxConsecutiveFailures !== undefined
        ? { maxConsecutiveFailures: schedule.maxConsecutiveFailures }
        : {}),
      ...(schedule.activeUntil ? { activeUntil: schedule.activeUntil } : {}),
    },
    target: {
      type: "execution_graph",
      graphId: row.graphId,
      taskId: row.taskId,
      resetNodeIds: schedule.resetNodeIds,
      ...(schedule.rootMessageId ? { rootMessageId: schedule.rootMessageId } : {}),
    },
    createdAt: schedule.createdAt || row.createdAt,
    body: "",
  };
}

export function graphAutomationToRuntimeState(row: LegacyGraphAutomationRow): AutomationRuntimeState {
  return initializeAutomationRuntimeState(graphAutomationToDefinition(row), {
    nextRunAt: row.schedule.nextTickAt,
    lastRunAt: row.schedule.lastTickAt,
    updatedAt: row.updatedAt,
    runCount: row.schedule.runCount,
    consecutiveFailures: row.schedule.consecutiveFailures,
    tickInProgress: row.schedule.tickInProgress,
  });
}
