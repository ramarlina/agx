import { NextResponse } from "next/server";
import { MAX_WORKERS, assertWorkerCount } from "@/lib/limits";
import { getAll } from "@/lib/agent-process-registry";

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
export async function GET() {
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
  const body = await req.json();

  // Stop action
  if (body.action === "stop") {
    state.running = false;
    state.targetWorkers = 0;
    state.startedAt = null;
    return NextResponse.json({ running: false, targetWorkers: 0 });
  }

  // Start / reconfigure
  const workers = typeof body.workers === "number" ? body.workers : 1;

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
