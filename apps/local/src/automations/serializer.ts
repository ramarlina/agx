import { dump } from "js-yaml";

import {
  DEFAULT_CANCEL_CHECK_SEC,
  DEFAULT_CATCH_UP_POLICY,
  DEFAULT_OVERLAP_POLICY,
  type AutomationDefinition,
} from "./types";
import { getExecutionWithDefaults, resolvePromptFromDefinition } from "./validation";

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const normalizedChild = stripUndefined(child);
    if (normalizedChild === undefined || normalizedChild === null || normalizedChild === "") {
      continue;
    }
    if (
      normalizedChild
      && typeof normalizedChild === "object"
      && !Array.isArray(normalizedChild)
      && Object.keys(normalizedChild as Record<string, unknown>).length === 0
    ) {
      continue;
    }
    next[key] = normalizedChild;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function serializeAutomationDefinition(definition: AutomationDefinition): string {
  const execution = getExecutionWithDefaults(definition);
  const prompt = resolvePromptFromDefinition(definition);
  const body = typeof definition.body === "string" ? definition.body : "";

  const target = { ...definition.target } as Record<string, unknown>;
  if (
    definition.target.type === "prompt_job"
    && typeof target.prompt === "string"
    && body.trim().length > 0
    && target.prompt === prompt
  ) {
    delete target.prompt;
  }

  const frontmatter = stripUndefined({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    projectId: definition.projectId,
    state: definition.state,
    trigger: definition.trigger,
    execution: {
      ...(execution.overlapPolicy !== DEFAULT_OVERLAP_POLICY
        ? { overlapPolicy: execution.overlapPolicy }
        : {}),
      ...(execution.catchUpPolicy !== DEFAULT_CATCH_UP_POLICY
        ? { catchUpPolicy: execution.catchUpPolicy }
        : {}),
      ...(execution.cancelCheckSec !== DEFAULT_CANCEL_CHECK_SEC
        ? { cancelCheckSec: execution.cancelCheckSec }
        : {}),
      ...(definition.execution?.maxRuns !== undefined
        ? { maxRuns: definition.execution.maxRuns }
        : {}),
      ...(definition.execution?.maxConsecutiveFailures !== undefined
        ? { maxConsecutiveFailures: definition.execution.maxConsecutiveFailures }
        : {}),
      ...(definition.execution?.activeUntil
        ? { activeUntil: definition.execution.activeUntil }
        : {}),
    },
    target,
    createdAt: definition.createdAt,
  }) as Record<string, unknown>;

  const yaml = dump(frontmatter, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  }).trimEnd();

  return body.length > 0
    ? `---\n${yaml}\n---\n${body}`
    : `---\n${yaml}\n---\n`;
}
