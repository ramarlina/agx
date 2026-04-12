import { NextRequest, NextResponse } from "next/server";
import { getProjectVariables, setProjectVariable, deleteProjectVariable } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/projects/[id]/variables — list keys with isSet flag (no values) */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const variables = await getProjectVariables(projectId);
    return NextResponse.json({
      variables: variables.map((v) => ({ key: v.key, isSet: true })),
    });
  } catch (error) {
    console.error("Error fetching project variables:", error);
    return NextResponse.json({ error: "Failed to fetch project variables" }, { status: 500 });
  }
}

/** POST /api/projects/[id]/variables — set a variable (upsert) */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const key = typeof body.key === "string" ? body.key.trim() : "";
    const value = typeof body.value === "string" ? body.value : "";

    if (!key) {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }

    if (!KEY_PATTERN.test(key)) {
      return NextResponse.json(
        { error: "Key must match [A-Z_][A-Z0-9_]* (uppercase letters, digits, and underscores only)" },
        { status: 400 },
      );
    }

    const variable = await setProjectVariable(projectId, key, value);
    return NextResponse.json({ variable }, { status: 201 });
  } catch (error) {
    console.error("Error setting project variable:", error);
    return NextResponse.json({ error: "Failed to set project variable" }, { status: 500 });
  }
}

/** DELETE /api/projects/[id]/variables?key=<key> — delete a variable */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const key = new URL(request.url).searchParams.get("key");
    if (!key) {
      return NextResponse.json({ error: "key query param is required" }, { status: 400 });
    }

    await deleteProjectVariable(projectId, key);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting project variable:", error);
    return NextResponse.json({ error: "Failed to delete project variable" }, { status: 500 });
  }
}
