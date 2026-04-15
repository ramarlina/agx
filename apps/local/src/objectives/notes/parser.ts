import path from "path";
import { load } from "js-yaml";
import type { ObjectiveNoteFile } from "./types";

const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*(?:\n([\s\S]*))?$/;

// Matches filenames like: 2026-04-15-22-30-00-000-my-note-slug.md
const FILENAME_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{3})-(.+)\.md$/;

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readTimestamp(value: unknown, fallback = "1970-01-01T00:00:00.000Z"): string {
  if (typeof value !== "string") return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

function deriveFromFilename(filePath: string): { id: string; title: string; createdAt: string } {
  const basename = path.basename(filePath);
  const match = basename.match(FILENAME_TIMESTAMP_PATTERN);
  if (match) {
    const [, year, month, day, hour, min, sec, ms, slug] = match;
    const createdAt = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}.${ms}Z`).toISOString();
    const title = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return { id: slug, title, createdAt };
  }
  const slug = basename.replace(/\.md$/, "");
  return { id: slug, title: slug, createdAt: "1970-01-01T00:00:00.000Z" };
}

function deriveTitle(body: string, fallback: string): string {
  const h1 = body.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : fallback;
}

export function parseNoteFile(
  markdown: string,
  options: { filePath?: string } = {},
): ObjectiveNoteFile {
  const match = markdown.match(FRONTMATTER_PATTERN);

  if (!match) {
    // Gracefully handle notes written without frontmatter by deriving metadata
    // from the filename and content rather than hard-failing.
    const derived = options.filePath
      ? deriveFromFilename(options.filePath)
      : { id: "", title: "Untitled", createdAt: "1970-01-01T00:00:00.000Z" };
    const body = markdown.trim();
    return {
      id: derived.id,
      title: deriveTitle(body, derived.title),
      objectiveId: "",
      createdAt: derived.createdAt,
      updatedAt: derived.createdAt,
      body,
    };
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
