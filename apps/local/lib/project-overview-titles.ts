import type { GroupMessage } from "@/lib/types";

function normalizeTitle(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function truncateTitle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function deriveTitleFromText(content: string | null | undefined, maxLength = 80): string | null {
  const normalized = normalizeTitle(content);
  if (!normalized) return null;

  const plain = normalized
    .replace(/\[agx:spawn\]\s*/g, "")
    .replace(/\s*\[agx:exit:\d+\]\s*/g, "")
    .replace(/\[reaction[^\]]*\]/g, "")
    .replace(/\[SKIP\]/g, "")
    .trim();

  if (!plain) return null;

  const firstLine = plain
    .split("\n")[0]
    ?.replace(/\s+/g, " ")
    .trim();

  return firstLine ? truncateTitle(firstLine, maxLength) : null;
}

export function resolveAutomationTitle(input: {
  automationName?: string | null;
  graphId: string;
  taskTitle?: string | null;
  taskContent?: string | null;
}): string {
  const automationName = normalizeTitle(input.automationName);
  if (automationName && automationName !== input.graphId) {
    return automationName;
  }

  const taskTitle = normalizeTitle(input.taskTitle);
  if (taskTitle) {
    return truncateTitle(taskTitle, 80);
  }

  const derivedTaskTitle = deriveTitleFromText(input.taskContent, 80);
  if (derivedTaskTitle) {
    return derivedTaskTitle;
  }

  return "Untitled scheduled task";
}

export function resolveThreadTitle(input: {
  threadTitle?: string | null;
  messages?: GroupMessage[] | null;
  fallbackTitle: string;
}): string {
  const explicitTitle = normalizeTitle(input.threadTitle);
  if (explicitTitle) {
    return explicitTitle;
  }

  const firstUserMessage = input.messages?.find((message) => message.role === "user")?.content;
  const derivedTitle = deriveTitleFromText(firstUserMessage, 60);
  if (derivedTitle) {
    return derivedTitle;
  }

  return input.fallbackTitle;
}
