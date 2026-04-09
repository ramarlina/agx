import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-instance";
import type { LearningScope } from "@/lib/db-adapter.interface";
import { LOCAL_USER } from "@/lib/auth-mode";

// GET /api/learnings - Get learnings by scope
export async function GET(request: NextRequest) {
  try {
    const userId = LOCAL_USER.id;

    const { searchParams } = new URL(request.url);
    const scope = (searchParams.get("scope") || "global") as LearningScope;
    const scopeId = searchParams.get("scopeId") || undefined;

    const learnings = await db.getLearnings(scope, scopeId, userId);
    return NextResponse.json({ learnings });
  } catch (error) {
    console.error("Error fetching learnings:", error);
    return NextResponse.json({ error: "Failed to fetch learnings" }, { status: 500 });
  }
}

// POST /api/learnings - Add a learning
export async function POST(request: NextRequest) {
  try {
    const userId = LOCAL_USER.id;

    const body = await request.json();
    const { scope, scopeId, content } = body;

    if (!scope || !content) {
      return NextResponse.json(
        { error: "Scope and content are required" },
        { status: 400 }
      );
    }

    const learning = await db.addLearning(scope, content, scopeId, userId);

    return NextResponse.json({ learning }, { status: 201 });
  } catch (error) {
    console.error("Error adding learning:", error);
    return NextResponse.json({ error: "Failed to add learning" }, { status: 500 });
  }
}

// DELETE /api/learnings - Delete a learning
export async function DELETE(request: NextRequest) {
  try {
    const userId = LOCAL_USER.id;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    await db.deleteLearning(id, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting learning:", error);
    return NextResponse.json({ error: "Failed to delete learning" }, { status: 500 });
  }
}

