import { NextRequest, NextResponse } from "next/server";
import { loadTaskDependencyGraph } from "@/lib/dependency-manager";
import { LOCAL_USER } from "@/lib/auth-mode";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const taskId = String(id || "").trim();
  if (!taskId) {
    return NextResponse.json({ error: "Task ID is required" }, { status: 400 });
  }

  try {
    const graph = await loadTaskDependencyGraph(taskId, LOCAL_USER.id);
    return NextResponse.json(graph);
  } catch (error) {
    console.error("Error loading dependency graph", error);
    return NextResponse.json({ error: "Failed to load dependency graph" }, { status: 500 });
  }
}
