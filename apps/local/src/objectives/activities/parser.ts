import { load } from "js-yaml";
import type { ObjectiveActivityFile, ObjectiveActivityType } from "./types";

const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*(?:\n([\s\S]*))?$/;
const ACTIVITY_TYPES = new Set<ObjectiveActivityType>(["metric-check", "action", "milestone", "note"]);

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readTimestamp(value: unknown, fallback = "1970-01-01T00:00:00.000Z"): string {
  if (typeof value !== "string") return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

function readActivityType(value: unknown): ObjectiveActivityType {
  return typeof value === "string" && ACTIVITY_TYPES.has(value as ObjectiveActivityType)
    ? (value as ObjectiveActivityType)
    : "note";
}

export function parseActivityFile(
  markdown: string,
  options: { filePath?: string } = {},
): ObjectiveActivityFile {
  const match = markdown.match(FRONTMATTER_PATTERN);
  if (!match) {
    throw new Error(
      `Activity file is missing YAML frontmatter${options.filePath ? ` (${options.filePath})` : ""}.`,
    );
  }

  const [, rawFrontmatter, rawBody = ""] = match;
  const loaded = load(rawFrontmatter, {
    ...(options.filePath ? { filename: options.filePath } : {}),
  });

  const fm = loaded && typeof loaded === "object" && !Array.isArray(loaded)
    ? (loaded as Record<string, unknown>)
    : {};

  return {
    id: readString(fm.id),
    source: readString(fm.source, "manual"),
    objectiveLabel: readString(fm.objectiveLabel),
    createdAt: readTimestamp(fm.createdAt),
    type: readActivityType(fm.type),
    body: rawBody.trim(),
  };
}
