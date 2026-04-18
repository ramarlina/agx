import { NextRequest, NextResponse } from "next/server";
import { updateWorkspaceEntry, deleteWorkspaceEntry } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { parseBody } from "@/lib/parse-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; entryId: string }> };

function isUniqueConstraintError(error: unknown): boolean {
  if (error instanceof ConflictError) return true;
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (code === "SQLITE_CONSTRAINT_UNIQUE") return true;
  }
  return false;
}

/** PATCH /api/projects/[id]/workspace/[entryId] — update a workspace entry */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId, entryId } = await context.params;
    const parsed = await parseBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const updates: { name?: string; path?: string | null; purpose?: string | null; sort_order?: number } = {};
    if (typeof body.name === "string") updates.name = body.name.trim();
    if (body.path !== undefined) updates.path = typeof body.path === "string" ? body.path.trim() || null : null;
    if (body.purpose !== undefined) updates.purpose = typeof body.purpose === "string" ? body.purpose.trim() || null : null;
    if (typeof body.sort_order === "number") updates.sort_order = body.sort_order;

    if (!Object.keys(updates).length) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const entry = await updateWorkspaceEntry(projectId, entryId, updates);
    if (!entry) {
      return NextResponse.json({ error: "Workspace entry not found" }, { status: 404 });
    }

    return NextResponse.json({ entry });
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: "An entry with this name already exists in this category" },
        { status: 409 },
      );
    }
    logger.error("Error updating workspace entry", logger.formatError(error));
    return NextResponse.json({ error: "Failed to update workspace entry" }, { status: 500 });
  }
}

/** DELETE /api/projects/[id]/workspace/[entryId] — remove a workspace entry */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId, entryId } = await context.params;
    await deleteWorkspaceEntry(projectId, entryId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Error deleting workspace entry", logger.formatError(error));
    return NextResponse.json({ error: "Failed to delete workspace entry" }, { status: 500 });
  }
}
