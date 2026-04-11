import fs from "fs";
import path from "path";
import { homedir } from "os";

import { parseObjectiveMarkdown } from "./parser";
import { serializeObjectiveFile } from "./serializer";
import type {
  ProjectObjective,
  ProjectObjectiveActivity,
  ProjectObjectiveActivityThreadMessage,
  ProjectObjectiveWorkspaceState,
} from "@/lib/project-objectives";

function resolveAgxDataDir(): string {
  const configured = process.env.AGX_DATA_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(homedir(), ".agx");
}

export function getObjectivesDir(projectSlug: string): string {
  return path.join(resolveAgxDataDir(), "projects", projectSlug, "objectives");
}

export class ObjectiveRepository {
  readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  private ensureDir(): void {
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  readWorkspace(): ProjectObjectiveWorkspaceState {
    if (!fs.existsSync(this.rootDir)) {
      return { objectives: [], activities: [], activityThreads: {} };
    }

    const files = fs.readdirSync(this.rootDir).filter((name) => name.endsWith(".md"));
    const objectives: ProjectObjective[] = [];
    const activities: ProjectObjectiveActivity[] = [];
    const activityThreads: Record<string, ProjectObjectiveActivityThreadMessage[]> = {};

    for (const file of files) {
      const filePath = path.join(this.rootDir, file);
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = parseObjectiveMarkdown(raw, { filePath });
        objectives.push(parsed.objective);
        activities.push(...parsed.activities);
        Object.assign(activityThreads, parsed.activityThreads);
      } catch (error) {
        console.error(`[objectives] failed to read ${filePath}:`, error);
      }
    }

    return { objectives, activities, activityThreads };
  }

  writeWorkspace(workspace: ProjectObjectiveWorkspaceState): void {
    this.ensureDir();

    const existingFiles = fs.existsSync(this.rootDir)
      ? new Set(fs.readdirSync(this.rootDir).filter((name) => name.endsWith(".md")))
      : new Set<string>();

    const writtenFiles = new Set<string>();

    for (const objective of workspace.objectives) {
      const filename = `${objective.key}.md`;
      const filePath = path.join(this.rootDir, filename);
      const content = serializeObjectiveFile(
        objective,
        workspace.activities,
        workspace.activityThreads,
      );
      fs.writeFileSync(filePath, content, "utf8");
      writtenFiles.add(filename);
    }

    for (const existing of existingFiles) {
      if (!writtenFiles.has(existing)) {
        const filePath = path.join(this.rootDir, existing);
        // Check if this file's objective ID is still in the workspace
        // (handles key renames — old key file gets cleaned up)
        try {
          const raw = fs.readFileSync(filePath, "utf8");
          const parsed = parseObjectiveMarkdown(raw, { filePath });
          const stillExists = workspace.objectives.some(
            (o) => o.id === parsed.objective.id,
          );
          if (!stillExists) {
            fs.rmSync(filePath, { force: true });
          } else {
            // Key was renamed — old file is now stale, remove it
            fs.rmSync(filePath, { force: true });
          }
        } catch {
          fs.rmSync(filePath, { force: true });
        }
      }
    }
  }

  findObjectiveByKey(key: string): ProjectObjective | null {
    const filePath = path.join(this.rootDir, `${key}.md`);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      return parseObjectiveMarkdown(raw, { filePath }).objective;
    } catch {
      return null;
    }
  }

  findObjectiveById(id: string): ProjectObjective | null {
    if (!fs.existsSync(this.rootDir)) return null;
    const files = fs.readdirSync(this.rootDir).filter((name) => name.endsWith(".md"));
    for (const file of files) {
      const filePath = path.join(this.rootDir, file);
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = parseObjectiveMarkdown(raw, { filePath });
        if (parsed.objective.id === id) return parsed.objective;
      } catch {
        continue;
      }
    }
    return null;
  }

  deleteObjective(key: string): boolean {
    const filePath = path.join(this.rootDir, `${key}.md`);
    if (!fs.existsSync(filePath)) return false;
    fs.rmSync(filePath, { force: true });
    return true;
  }

  hasFiles(): boolean {
    if (!fs.existsSync(this.rootDir)) return false;
    return fs.readdirSync(this.rootDir).some((name) => name.endsWith(".md"));
  }
}

const repositoryCache = new Map<string, ObjectiveRepository>();

export function getObjectiveRepository(projectSlug: string): ObjectiveRepository {
  const rootDir = getObjectivesDir(projectSlug);
  let repo = repositoryCache.get(rootDir);
  if (!repo) {
    repo = new ObjectiveRepository(rootDir);
    repositoryCache.set(rootDir, repo);
  }
  return repo;
}
