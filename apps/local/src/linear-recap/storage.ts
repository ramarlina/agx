import { promises as fs } from "fs";
import os from "os";
import path from "path";

const LATEST_FILENAME = "latest.md";
const MAX_RETAINED = 10;

function agxHome(): string {
  return process.env.AGX_HOME ?? path.join(os.homedir(), ".agx");
}

function recapsDir(issueId: string): string {
  return path.join(agxHome(), "linear", issueId, "recaps");
}

function timestampedName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-") + ".md";
}

export interface WriteRecapResult {
  filePath: string;
  latestPath: string;
  generatedAt: Date;
}

export async function writeRecap(
  issueId: string,
  content: string
): Promise<WriteRecapResult> {
  const dir = recapsDir(issueId);
  await fs.mkdir(dir, { recursive: true });

  const filename = timestampedName();
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, content, "utf8");

  const latestPath = path.join(dir, LATEST_FILENAME);
  try {
    await fs.unlink(latestPath);
  } catch {
    // not there yet
  }
  await fs.symlink(filename, latestPath);

  await pruneOld(dir);

  const stat = await fs.stat(filePath);
  return { filePath, latestPath, generatedAt: stat.mtime };
}

export interface ReadRecapResult {
  content: string;
  filePath: string;
  generatedAt: Date;
}

export async function readLatestRecap(
  issueId: string
): Promise<ReadRecapResult | null> {
  const latestPath = path.join(recapsDir(issueId), LATEST_FILENAME);
  try {
    const stat = await fs.stat(latestPath);
    const content = await fs.readFile(latestPath, "utf8");
    return { content, filePath: latestPath, generatedAt: stat.mtime };
  } catch {
    return null;
  }
}

export function getLatestRecapPath(issueId: string): string {
  return path.join(recapsDir(issueId), LATEST_FILENAME);
}

async function pruneOld(dir: string): Promise<void> {
  const entries = await fs.readdir(dir);
  const recapFiles = entries
    .filter((name) => name.endsWith(".md") && name !== LATEST_FILENAME)
    .sort()
    .reverse();
  const toDelete = recapFiles.slice(MAX_RETAINED);
  for (const name of toDelete) {
    try {
      await fs.unlink(path.join(dir, name));
    } catch {
      // ignore
    }
  }
}
