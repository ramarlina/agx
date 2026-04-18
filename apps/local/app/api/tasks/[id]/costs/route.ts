import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-instance";
import { LOCAL_USER } from "@/lib/auth-mode";
import { logger } from "@/lib/logger";

function normalizeTaskId(rawId: unknown): string | null {
  if (typeof rawId === "string") {
    const normalized = rawId.trim();
    if (!normalized) return null;
    if (["[object Object]", "undefined", "null"].includes(normalized)) return null;
    return normalized;
  }
  if (rawId && typeof rawId === "object" && "id" in rawId) {
    return normalizeTaskId((rawId as { id?: unknown }).id);
  }
  return null;
}

function normalizeStage(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const stage = String(raw).trim();
  if (!stage) return null;
  const normalized = stage.toLowerCase().replace(/\s+/g, "_");
  if (normalized === "intake" || normalized === "ideation") return "INTAKE";
  if (["progress", "in_progress", "planning", "coding", "execution", "qa", "acceptance", "verification", "pr", "smoke_test", "release"].includes(normalized)) return "PROGRESS";
  if (normalized === "done") return "DONE";
  return stage;
}

function isValidStageId(stage: string): boolean {
  if (stage.length > 64) return false;
  return /^[a-z0-9 _-]+$/i.test(stage);
}

function parsePositiveNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const taskId = normalizeTaskId(rawId);
    if (!taskId) {
      return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
    }

    const task = await db.getTask(taskId, LOCAL_USER.id);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const entries = await db.getTaskCostEntries(taskId);
    return NextResponse.json({ entries });
  } catch (error) {
    logger.error("Error fetching task costs", logger.formatError(error));
    return NextResponse.json({ error: "Failed to fetch task costs" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const taskId = normalizeTaskId(rawId);
    if (!taskId) {
      return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
    }

    const task = await db.getTask(taskId, LOCAL_USER.id);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch (err) {
      return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
    }

    const stage = normalizeStage(body?.stage);
    if (!stage || !isValidStageId(stage)) {
      return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
    }

    const provider = typeof body?.provider === "string" && body.provider.trim()
      ? body.provider.trim()
      : null;
    const model = typeof body?.model === "string" && body.model.trim()
      ? body.model.trim()
      : null;

    const inputTokens = parsePositiveNumber(body?.input_tokens);
    const outputTokens = parsePositiveNumber(body?.output_tokens);
    const estimatedCost = parsePositiveNumber(body?.estimated_cost);

    const entry = await db.addTaskCostEntry({
      taskId,
      stage,
      provider,
      model,
      inputTokens,
      outputTokens,
      estimatedCost,
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    logger.error("Error recording task cost", logger.formatError(error));
    return NextResponse.json({ error: "Failed to record task cost" }, { status: 500 });
  }
}
