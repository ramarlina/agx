import { createHash } from "crypto";
import { mkdtempSync } from "fs";
import { homedir, tmpdir } from "os";
import path from "path";

import { CronExpressionParser } from "cron-parser";

import {
  DEFAULT_GRAPH_INTERVAL_MS,
  type AutomationDefinition,
  type AutomationRuntimeState,
} from "./types";

let cachedTestAutomationsDir: string | null = null;

function resolveAgxDataDir(): string {
  const configured = process.env.AGX_DATA_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  return path.join(homedir(), ".agx");
}

function stableCopy(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableCopy(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const next: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    next[key] = stableCopy((value as Record<string, unknown>)[key]);
  }
  return next;
}

function computeCronNextRun(cronExpr: string, fromMs: number): number | null {
  try {
    const parsed = CronExpressionParser.parse(cronExpr, {
      currentDate: new Date(fromMs),
    });
    return parsed.next().toDate().getTime();
  } catch {
    return null;
  }
}

export function getDefaultAutomationsDir(): string {
  const configured = process.env.AGX_AUTOMATIONS_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  if (process.env.NODE_ENV === "test") {
    if (!cachedTestAutomationsDir) {
      cachedTestAutomationsDir = mkdtempSync(path.join(tmpdir(), "agx-cloud-automations-"));
    }
    return cachedTestAutomationsDir;
  }

  return path.join(resolveAgxDataDir(), "automations");
}

export function getLegacyRepoAutomationsDir(): string {
  return path.resolve(process.cwd(), "state", "automations");
}

export function encodeAutomationFilename(id: string): string {
  return `${encodeURIComponent(id)}.md`;
}

export function computeScheduleHash(definition: AutomationDefinition): string {
  const payload = stableCopy({
    state: definition.state,
    trigger: definition.trigger,
    execution: {
      overlapPolicy: definition.execution?.overlapPolicy,
      catchUpPolicy: definition.execution?.catchUpPolicy,
      maxRuns: definition.execution?.maxRuns,
      maxConsecutiveFailures: definition.execution?.maxConsecutiveFailures,
      activeUntil: definition.execution?.activeUntil,
    },
  });

  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

export function computeNextRunAt(
  definition: AutomationDefinition,
  nowMs: number = Date.now(),
): number | null {
  if (definition.state !== "active") {
    return null;
  }

  if (definition.trigger.type === "condition") {
    return nowMs + definition.trigger.checkEveryMs;
  }

  if (definition.trigger.intervalMs !== undefined) {
    return nowMs + definition.trigger.intervalMs;
  }

  if (!definition.trigger.cronExpr) {
    return nowMs + DEFAULT_GRAPH_INTERVAL_MS;
  }

  return computeCronNextRun(definition.trigger.cronExpr, nowMs);
}

export function initializeAutomationRuntimeState(
  definition: AutomationDefinition,
  existing?: Partial<AutomationRuntimeState>,
  nowMs: number = Date.now(),
): AutomationRuntimeState {
  const scheduleHash = computeScheduleHash(definition);
  const hashChanged = existing?.scheduleHash !== scheduleHash;
  const nextRunAt = hashChanged || existing?.nextRunAt === undefined
    ? computeNextRunAt(definition, nowMs)
    : existing.nextRunAt ?? null;

  return {
    scheduleHash,
    nextRunAt,
    lastRunAt: existing?.lastRunAt ?? null,
    lastOutcome: existing?.lastOutcome ?? null,
    lastError: existing?.lastError ?? null,
    updatedAt: existing?.updatedAt ?? new Date(nowMs).toISOString(),
    ...(existing?.runCount !== undefined ? { runCount: existing.runCount } : {}),
    ...(existing?.consecutiveFailures !== undefined
      ? { consecutiveFailures: existing.consecutiveFailures }
      : {}),
    ...(existing?.tickInProgress !== undefined ? { tickInProgress: existing.tickInProgress } : {}),
    ...(existing?.archivedAt !== undefined ? { archivedAt: existing.archivedAt } : {}),
  };
}

export function updateAutomationRuntimeState(
  definition: AutomationDefinition,
  existing: Partial<AutomationRuntimeState> | undefined,
  patch: Partial<AutomationRuntimeState>,
  nowMs: number = Date.now(),
): AutomationRuntimeState {
  const merged = initializeAutomationRuntimeState(definition, {
    ...(existing ?? {}),
    ...patch,
  }, nowMs);

  return {
    ...merged,
    updatedAt: patch.updatedAt ?? new Date(nowMs).toISOString(),
  };
}

export function isAutomationDue(
  definition: AutomationDefinition,
  runtimeState: AutomationRuntimeState,
  nowMs: number = Date.now(),
): boolean {
  if (definition.state !== "active") {
    return false;
  }

  if (runtimeState.tickInProgress) {
    return false;
  }

  if (runtimeState.nextRunAt === null || runtimeState.nextRunAt === undefined) {
    return false;
  }

  return runtimeState.nextRunAt <= nowMs;
}
