import { NextResponse } from "next/server";
import { spawnSync } from "child_process";
import { MAX_WORKERS, WRITE_QPS_CEILING } from "@/lib/limits";
import { PROVIDER_CLIS } from "@/lib/provider-clis";
import { getConfiguredBoardBaseUrl } from "@/lib/app-config";
import { buildSpawnEnv, commandExists } from "@/lib/shell-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ServiceStatus {
  name: string;
  status: "ok" | "error" | "unavailable";
  latencyMs?: number;
  detail?: string;
}

const AGX_BOARD_URL = getConfiguredBoardBaseUrl();

async function checkUrl(url: string, timeoutMs = 5000): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return { ok: false, latencyMs, detail: `HTTP ${res.status}` };
    }
    return { ok: true, latencyMs };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

export async function GET() {
  const services: ServiceStatus[] = [];

  // 1. agx-cloud (self-check)
  const boardCheck = await checkUrl(`${AGX_BOARD_URL}/api/projects`);
  services.push({
    name: "agx-cloud",
    status: boardCheck.ok ? "ok" : "error",
    latencyMs: boardCheck.latencyMs,
    detail: boardCheck.ok ? `Running at ${AGX_BOARD_URL}` : boardCheck.detail,
  });

  // 3. CLI providers
  const cliTools = [
    { id: "agx", bin: "agx", label: "Installed" },
    ...PROVIDER_CLIS.map((provider) => ({
      id: provider.id,
      bin: provider.bin,
      label: provider.statusLabel ?? "Installed",
    })),
  ] as const;
  for (const tool of cliTools) {
    const exists = commandExists(tool.bin);
    services.push({
      name: `cli:${tool.id}`,
      status: exists ? "ok" : "unavailable",
      detail: exists ? tool.label : `Not found in PATH (${tool.bin})`,
    });
  }

  // CLI version
  let cliVersion: string | null = null;
  try {
    const result = spawnSync("agx", ["--version"], {
      encoding: "utf8",
      timeout: 5000,
      env: buildSpawnEnv(),
    });
    if (result.status === 0) cliVersion = result.stdout.trim();
  } catch {}

  const overall = services.every((s) => s.status !== "error") ? "ok" : "degraded";

  return NextResponse.json({
    status: overall,
    services,
    cliVersion,
    limits: { maxWorkers: MAX_WORKERS, writeQpsCeiling: WRITE_QPS_CEILING },
    timestamp: new Date().toISOString(),
  });
}
