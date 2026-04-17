import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GithubTokens } from "./github-types";

function projectTokenPath(projectId: string): string {
  const base = process.env.AGX_DATA_DIR || path.join(os.homedir(), ".agx");
  return path.join(base, "projects", projectId, "integrations", "github.json");
}

export function saveGithubTokens(projectId: string, tokens: GithubTokens): void {
  const p = projectTokenPath(projectId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function loadGithubTokens(projectId: string): GithubTokens | null {
  const p = projectTokenPath(projectId);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as GithubTokens;
    if (typeof parsed.accessToken !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearGithubTokens(projectId: string): void {
  const p = projectTokenPath(projectId);
  if (fs.existsSync(p)) fs.rmSync(p);
}

export function githubTokensExpired(
  tokens: GithubTokens,
  skewMs = 60_000,
): boolean {
  if (tokens.expiresAt == null) return false;
  return Date.now() >= tokens.expiresAt - skewMs;
}
