import { load } from "js-yaml";

import type {
  ProjectObjective,
  ProjectObjectiveActivity,
  ProjectObjectiveActivityThreadMessage,
  ProjectObjectiveWorkspaceState,
} from "@/lib/project-objectives";

const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*(?:\n([\s\S]*))?$/;

function normalizeLoadedYaml(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function readTimestamp(value: unknown, fallback = "1970-01-01T00:00:00.000Z"): string {
  if (typeof value !== "string") return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

function readProgress(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

const HEALTH_VALUES = new Set(["on_track", "at_risk", "off_track", "done"]);

function readHealth(value: unknown): ProjectObjective["status"] {
  return typeof value === "string" && HEALTH_VALUES.has(value)
    ? (value as ProjectObjective["status"])
    : "on_track";
}

function readNonNegativeInteger(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

export function parseObjectiveFrontmatter(raw: Record<string, unknown>, summary: string): ProjectObjective {
  const updatedAt = readTimestamp(raw.updatedAt ?? raw.createdAt);
  const createdAt = readTimestamp(raw.createdAt, updatedAt);

  return {
    id: readString(raw.id),
    title: readString(raw.title, "Untitled objective"),
    teamId: readString(raw.teamId),
    key: readString(raw.key),
    threadId: readString(raw.threadId) || null,
    chatSessionVersion: readNonNegativeInteger(raw.chatSessionVersion, 0),
    scheduledTaskIds: readStringArray(raw.scheduledTaskIds),
    summary,
    progress: readProgress(raw.progress),
    status: readHealth(raw.status),
    createdAt,
    updatedAt,
  };
}

interface ParsedBody {
  summary: string;
  activities: ProjectObjectiveActivity[];
  activityThreads: Record<string, ProjectObjectiveActivityThreadMessage[]>;
}

function parseActivityBlock(
  block: string,
  objectiveId: string,
): { activity: ProjectObjectiveActivity; replies: ProjectObjectiveActivityThreadMessage[] } | null {
  const lines = block.split("\n");
  const titleLine = lines[0];
  if (!titleLine) return null;

  const title = titleLine.replace(/^###\s+/, "").trim();
  if (!title) return null;

  let id = "";
  let sourceLabel = "Update";
  let createdAt = "";
  let body = "";
  let relatedTaskId: string | null = null;
  const replies: ProjectObjectiveActivityThreadMessage[] = [];

  let inReplies = false;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("#### Replies")) {
      inReplies = true;
      continue;
    }

    if (inReplies) {
      const replyMatch = line.match(
        /^- \*\*(.+?)\*\*\s+\((\d{4}-\S+)\):\s*(.+)$/,
      );
      if (replyMatch) {
        const [, author, timestamp, replyBody] = replyMatch;
        replies.push({
          id: `reply_${Math.random().toString(36).slice(2, 10)}`,
          activityId: id,
          author,
          body: replyBody,
          createdAt: readTimestamp(timestamp),
        });
      }
      continue;
    }

    const metaMatch = line.match(/^- \*\*(\w+):\*\*\s*(.+)$/);
    if (metaMatch) {
      const [, key, value] = metaMatch;
      switch (key) {
        case "id":
          id = value.trim();
          break;
        case "source":
          sourceLabel = value.trim();
          break;
        case "created":
          createdAt = readTimestamp(value.trim());
          break;
        case "body":
          body = value.trim();
          break;
        case "relatedTaskId":
          relatedTaskId = value.trim() || null;
          break;
      }
      continue;
    }
  }

  if (!id) {
    id = `objective_activity_${Math.random().toString(36).slice(2, 10)}`;
  }
  if (!createdAt) {
    createdAt = new Date().toISOString();
  }

  for (const reply of replies) {
    reply.activityId = id;
  }

  return {
    activity: {
      id,
      objectiveId,
      sourceType: "note",
      sourceLabel,
      title,
      body,
      createdAt,
      updatedAt: createdAt,
      relatedTaskId,
    },
    replies,
  };
}

export function parseObjectiveBody(markdown: string, objectiveId: string): ParsedBody {
  const sections = markdown.split(/(?=^## )/m);
  let summary = "";
  const activities: ProjectObjectiveActivity[] = [];
  const activityThreads: Record<string, ProjectObjectiveActivityThreadMessage[]> = {};

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("## Notes")) {
      summary = trimmed.replace(/^## Notes\s*/, "").trim();
      continue;
    }

    if (trimmed.startsWith("## Activities")) {
      const activityBlocks = trimmed.split(/(?=^### )/m).slice(1);
      for (const block of activityBlocks) {
        const parsed = parseActivityBlock(block.trim(), objectiveId);
        if (!parsed) continue;
        activities.push(parsed.activity);
        if (parsed.replies.length > 0) {
          activityThreads[parsed.activity.id] = parsed.replies;
        }
      }
      continue;
    }

    if (!trimmed.startsWith("## ")) {
      summary = trimmed;
    }
  }

  return { summary, activities, activityThreads };
}

export interface ParsedObjectiveFile {
  objective: ProjectObjective;
  activities: ProjectObjectiveActivity[];
  activityThreads: Record<string, ProjectObjectiveActivityThreadMessage[]>;
}

export function parseObjectiveMarkdown(
  markdown: string,
  options: { filePath?: string } = {},
): ParsedObjectiveFile {
  const match = markdown.match(FRONTMATTER_PATTERN);
  if (!match) {
    throw new Error(
      `Objective file is missing YAML frontmatter${options.filePath ? ` (${options.filePath})` : ""}.`,
    );
  }

  const [, rawFrontmatter, rawBody = ""] = match;
  const loaded = normalizeLoadedYaml(
    load(rawFrontmatter, {
      ...(options.filePath ? { filename: options.filePath } : {}),
    }),
  );

  const objectiveId = readString(loaded.id);
  const { summary, activities, activityThreads } = parseObjectiveBody(rawBody, objectiveId);
  const objective = parseObjectiveFrontmatter(loaded, summary);

  return { objective, activities, activityThreads };
}
