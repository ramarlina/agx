import fs from "fs";
import path from "path";
import { homedir } from "os";

export const PROGRAM_FILENAME = "program.md";

function resolveAgxDataDir(): string {
  const configured = process.env.AGX_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(homedir(), ".agx");
}

export function getProgramPath(projectSlug: string, objectiveKey: string): string {
  return path.join(
    resolveAgxDataDir(),
    "projects",
    projectSlug,
    "objectives",
    objectiveKey,
    PROGRAM_FILENAME,
  );
}

export interface ObjectiveProgram {
  path: string;
  content: string | null;
  updatedAt: string | null;
}

export function readProgram(projectSlug: string, objectiveKey: string): ObjectiveProgram {
  const filePath = getProgramPath(projectSlug, objectiveKey);
  if (!fs.existsSync(filePath)) {
    return { path: filePath, content: null, updatedAt: null };
  }
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const stat = fs.statSync(filePath);
    return { path: filePath, content, updatedAt: stat.mtime.toISOString() };
  } catch {
    return { path: filePath, content: null, updatedAt: null };
  }
}

export function writeProgram(
  projectSlug: string,
  objectiveKey: string,
  content: string,
): ObjectiveProgram {
  const filePath = getProgramPath(projectSlug, objectiveKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const trimmed = content.replace(/\s+$/g, "");
  if (trimmed.length === 0) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { path: filePath, content: null, updatedAt: null };
  }
  const body = trimmed + "\n";
  fs.writeFileSync(filePath, body, "utf8");
  const stat = fs.statSync(filePath);
  return { path: filePath, content: body, updatedAt: stat.mtime.toISOString() };
}
