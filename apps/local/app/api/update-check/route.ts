import { NextResponse } from "next/server";
import { spawnSync } from "child_process";
import { buildSpawnEnv } from "@/lib/shell-env";
import { SHELL_COMMAND_TIMEOUT_MS } from "@/lib/constants/timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseVersion(raw: string): string | null {
  // agx --version outputs e.g. "agx/1.2.3 darwin-arm64 node-v20"
  const match = raw.match(/agx\/(\S+)/);
  return match ? match[1] : null;
}

export async function GET() {
  let latestVersion: string | null = null;
  let currentVersion: string | null = null;

  try {
    const res = await fetch("https://registry.npmjs.org/agx/latest", {
      signal: AbortSignal.timeout(SHELL_COMMAND_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = (await res.json()) as { version: string };
      latestVersion = data.version;
    }
  } catch {
    // fail silently
  }

  try {
    const result = spawnSync("agx", ["--version"], {
      encoding: "utf8",
      timeout: SHELL_COMMAND_TIMEOUT_MS,
      env: buildSpawnEnv(),
    });
    if (result.status === 0) {
      currentVersion = parseVersion(result.stdout.trim());
    }
  } catch {
    // fail silently
  }

  const updateAvailable =
    latestVersion !== null &&
    currentVersion !== null &&
    latestVersion !== currentVersion;

  return NextResponse.json({ updateAvailable, latestVersion, currentVersion });
}
