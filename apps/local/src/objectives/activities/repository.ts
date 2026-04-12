import fs from "fs";
import path from "path";
import { homedir } from "os";

import { parseActivityFile } from "./parser";
import { serializeActivityFile } from "./serializer";
import type {
  ObjectiveActivityFile,
  ObjectiveActivityListOptions,
  ObjectiveActivityPage,
} from "./types";

function resolveAgxDataDir(): string {
  const configured = process.env.AGX_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(homedir(), ".agx");
}

export function getActivitiesDir(projectSlug: string, objectiveKey: string): string {
  return path.join(
    resolveAgxDataDir(),
    "projects",
    projectSlug,
    "objectives",
    objectiveKey,
    "activities",
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function buildActivityFilename(activity: ObjectiveActivityFile): string {
  const ts = activity.createdAt.replace(/[:.]/g, "-").replace("T", "-").replace("Z", "");
  const slug = slugify(activity.type);
  return `${ts}-${slug}.md`;
}

export class ActivityRepository {
  readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  private ensureDir(): void {
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  readAll(): ObjectiveActivityFile[] {
    if (!fs.existsSync(this.rootDir)) return [];

    const files = fs.readdirSync(this.rootDir).filter((name) => name.endsWith(".md"));
    const activities: ObjectiveActivityFile[] = [];

    for (const file of files) {
      const filePath = path.join(this.rootDir, file);
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        activities.push(parseActivityFile(raw, { filePath }));
      } catch (error) {
        console.error(`[activities] failed to read ${filePath}:`, error);
      }
    }

    return activities.sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  }

  list(options: ObjectiveActivityListOptions = {}): ObjectiveActivityPage {
    let activities = this.readAll();

    if (options.type) {
      activities = activities.filter((a) => a.type === options.type);
    }
    if (options.source) {
      activities = activities.filter((a) => a.source === options.source);
    }
    if (options.from) {
      const fromMs = Date.parse(options.from);
      if (!Number.isNaN(fromMs)) {
        activities = activities.filter((a) => Date.parse(a.createdAt) >= fromMs);
      }
    }
    if (options.to) {
      const toMs = Date.parse(options.to);
      if (!Number.isNaN(toMs)) {
        activities = activities.filter((a) => Date.parse(a.createdAt) <= toMs);
      }
    }

    const total = activities.length;
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 25));
    const offset = (page - 1) * limit;
    const paged = activities.slice(offset, offset + limit);

    return {
      activities: paged,
      total,
      page,
      limit,
      hasMore: offset + limit < total,
    };
  }

  append(activity: ObjectiveActivityFile): string {
    this.ensureDir();
    const filename = buildActivityFilename(activity);
    const filePath = path.join(this.rootDir, filename);
    const content = serializeActivityFile(activity);
    fs.writeFileSync(filePath, content, "utf8");
    return filePath;
  }
}

const repositoryCache = new Map<string, ActivityRepository>();

export function getActivityRepository(
  projectSlug: string,
  objectiveKey: string,
): ActivityRepository {
  const rootDir = getActivitiesDir(projectSlug, objectiveKey);
  let repo = repositoryCache.get(rootDir);
  if (!repo) {
    repo = new ActivityRepository(rootDir);
    repositoryCache.set(rootDir, repo);
  }
  return repo;
}
