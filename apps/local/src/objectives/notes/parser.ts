import { load } from "js-yaml";
import type { ObjectiveNoteFile } from "./types";

const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*(?:\n([\s\S]*))?$/;

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readTimestamp(value: unknown, fallback = "1970-01-01T00:00:00.000Z"): string {
  if (typeof value !== "string") return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

export function parseNoteFile(
  markdown: string,
  options: { filePath?: string } = {},
): ObjectiveNoteFile {
  const match = markdown.match(FRONTMATTER_PATTERN);
  if (!match) {
    throw new Error(
      `Note file is missing YAML frontmatter${options.filePath ? ` (${options.filePath})` : ""}.`,
    );
  }

  const [, rawFrontmatter, rawBody = ""] = match;
  const loaded = load(rawFrontmatter, {
    ...(options.filePath ? { filename: options.filePath } : {}),
  });

  const fm = loaded && typeof loaded === "object" && !Array.isArray(loaded)
    ? (loaded as Record<string, unknown>)
    : {};

  const createdAt = readTimestamp(fm.createdAt);
  const updatedAt = readTimestamp(fm.updatedAt, createdAt);

  return {
    id: readString(fm.id),
    title: readString(fm.title, "Untitled"),
    objectiveId: readString(fm.objectiveId),
    createdAt,
    updatedAt,
    body: rawBody.trim(),
  };
}
