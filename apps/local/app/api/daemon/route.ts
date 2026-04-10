import { NextResponse } from "next/server";
import { MAX_WORKERS, assertWorkerCount } from "@/lib/limits";
import { getAll } from "@/lib/agent-process-registry";
import { requireDaemonControl } from "@/lib/api/daemon-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * In-memory daemon state. This lives in the Next.js server process
 * which IS the single coordinator (see docs/LIMITS.md).
 */
interface DaemonState {
  running: boolean;
  targetWorkers: number;
  startedAt: string | null;
}

interface DaemonPayload {
  action?: unknown;
  workers?: unknown;
}

const state: DaemonState = {
  running: false,
  targetWorkers: 0,
  startedAt: null,
};

/** Count processes currently running or spawning */
function activeWorkerCount(): number {
  return getAll().filter(
    (p) => p.state === "running" || p.state === "spawning"
  ).length;
}

/**
 * GET /api/daemon — Check daemon status
 */
export async function GET(request: Request) {
  const auth = await requireDaemonControl(request);
  if (!auth.ok) {
    return auth.response;
  }

  const active = activeWorkerCount();
  return NextResponse.json({
    running: state.running,
    targetWorkers: state.targetWorkers,
    activeWorkers: active,
    maxWorkers: MAX_WORKERS,
    startedAt: state.startedAt,
  });
}

/**
 * POST /api/daemon — Start or reconfigure the daemon
 * Body: { workers: number } | { action: "stop" }
 */
export async function POST(req: Request) {
  const auth = await requireDaemonControl(req);
  if (!auth.ok) {
    return auth.response;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload: DaemonPayload =
    body && typeof body === "object" ? (body as DaemonPayload) : {};

  // Stop action
  if ("action" in payload && payload.action === "stop") {
    state.running = false;
    state.targetWorkers = 0;
    state.startedAt = null;
    return NextResponse.json({ running: false, targetWorkers: 0 });
  }

  // Start / reconfigure
  const workers = typeof payload.workers === "number" ? payload.workers : 1;

  try {
    assertWorkerCount(workers);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 }
    );
  }

  const wasRunning = state.running;
  state.running = true;
  state.targetWorkers = workers;
  if (!wasRunning) {
    state.startedAt = new Date().toISOString();
  }

  return NextResponse.json({
    running: true,
    targetWorkers: state.targetWorkers,
    activeWorkers: activeWorkerCount(),
    maxWorkers: MAX_WORKERS,
    startedAt: state.startedAt,
  });
}
