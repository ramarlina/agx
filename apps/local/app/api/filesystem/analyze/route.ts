// app/api/filesystem/analyze/route.ts
import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { stat } from "fs/promises";
import path from "path";

const execFileAsync = promisify(execFile);
const TIMEOUT = 10_000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RepoAnalysis {
  isGit: boolean;
  branch?: string;
  status?: { modified: number; untracked: number; staged: number };
  languages: Record<string, number>;
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function gitInfo(dirPath: string): Promise<Pick<RepoAnalysis, "isGit" | "branch" | "status">> {
  try {
    await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd: dirPath, timeout: TIMEOUT });
  } catch {
    return { isGit: false };
  }

  let branch: string | undefined;
  try {
    const { stdout } = await execFileAsync("git", ["branch", "--show-current"], { cwd: dirPath, timeout: TIMEOUT });
    branch = stdout.trim() || undefined;
  } catch { /* ignore */ }

  let statusCounts = { modified: 0, untracked: 0, staged: 0 };
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: dirPath, timeout: TIMEOUT });
    for (const line of stdout.split("\n").filter(Boolean)) {
      const x = line[0];
      const y = line[1];
      if (x === "?" && y === "?") statusCounts.untracked++;
      else if (x !== " " && x !== "?") statusCounts.staged++;
      else if (y !== " " && y !== "?") statusCounts.modified++;
    }
  } catch { /* ignore */ }

  return { isGit: true, branch, status: statusCounts };
}

const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
  py: "Python", rb: "Ruby", go: "Go", rs: "Rust", java: "Java",
  kt: "Kotlin", swift: "Swift", cs: "C#", cpp: "C++", c: "C", h: "C",
  php: "PHP", scala: "Scala", ex: "Elixir", exs: "Elixir",
  html: "HTML", css: "CSS", scss: "SCSS", md: "Markdown",
  json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML",
  sh: "Shell", bash: "Shell", zsh: "Shell",
};

async function detectLanguages(dirPath: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  try {
    const { stdout } = await execFileAsync(
      "find", [dirPath, "-maxdepth", "3", "-type", "f", "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*", "-not", "-path", "*/dist/*", "-not", "-path", "*/.next/*"],
      { cwd: dirPath, timeout: TIMEOUT }
    );
    for (const filePath of stdout.split("\n").filter(Boolean)) {
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const lang = EXTENSION_LANGUAGE[ext];
      if (lang) counts[lang] = (counts[lang] ?? 0) + 1;
    }
  } catch { /* ignore */ }
  return counts;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const dirPath = typeof body.path === "string" ? body.path.trim() : "";

    if (!dirPath) {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }

    if (!(await isDirectory(dirPath))) {
      return NextResponse.json({ error: "Not a valid directory" }, { status: 400 });
    }

    const [git, languages] = await Promise.all([gitInfo(dirPath), detectLanguages(dirPath)]);

    const analysis: RepoAnalysis = { ...git, languages };
    return NextResponse.json({ analysis });
  } catch (error) {
    console.error("Error analyzing directory:", error);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
