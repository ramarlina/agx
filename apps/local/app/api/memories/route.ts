import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { getSQLiteDb } from "@/lib/sqlite-query-adapter";

const VALID_MEMORY_TYPES = new Set(["outcome", "decision", "pattern", "gotcha"]);

interface MemoryRow {
  id: string;
  agent_id: string;
  task_id: string;
  memory_type: "outcome" | "decision" | "pattern" | "gotcha";
  content: string;
  content_hash: string;
  created_at: number;
}

interface MemoryInput {
  memory_type: string;
  content: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { agent_id, task_id, memories } = body as {
      agent_id?: string;
      task_id?: string;
      memories?: MemoryInput[];
    };

    if (!agent_id || !task_id) {
      return NextResponse.json({ error: "agent_id and task_id required" }, { status: 400 });
    }
    if (!Array.isArray(memories) || memories.length === 0) {
      return NextResponse.json({ inserted: 0 });
    }

    const db = getSQLiteDb();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO agent_memory (id, agent_id, task_id, memory_type, content, content_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    let inserted = 0;
    const now = Date.now();

    for (const mem of memories) {
      if (!VALID_MEMORY_TYPES.has(mem.memory_type) || !mem.content?.trim()) continue;
      const contentHash = createHash("sha256").update(mem.content.trim()).digest("hex");
      const result = stmt.run(
        randomUUID(),
        agent_id,
        task_id,
        mem.memory_type,
        mem.content.trim(),
        contentHash,
        now,
      );
      if (result.changes > 0) inserted++;
    }

    return NextResponse.json({ inserted });
  } catch (err) {
    console.error("[api/memories] POST error:", err);
    return NextResponse.json({ error: "Failed to store memories" }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const task_id = searchParams.get("task_id");
  const agent_id = searchParams.get("agent_id");

  if (!task_id && !agent_id) {
    return NextResponse.json(
      { error: "task_id or agent_id query parameter required" },
      { status: 400 }
    );
  }

  try {
    const db = getSQLiteDb();

    let rows: MemoryRow[];
    if (task_id) {
      rows = db
        .prepare("SELECT * FROM agent_memory WHERE task_id = ? ORDER BY created_at ASC")
        .all(task_id) as unknown as MemoryRow[];
    } else {
      rows = db
        .prepare("SELECT * FROM agent_memory WHERE agent_id = ? ORDER BY created_at ASC")
        .all(agent_id!) as unknown as MemoryRow[];
    }

    return NextResponse.json({ memories: rows });
  } catch (err) {
    console.error("[api/memories] GET error:", err);
    return NextResponse.json({ error: "Failed to fetch memories" }, { status: 500 });
  }
}
