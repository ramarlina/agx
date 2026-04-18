import { NextRequest, NextResponse } from "next/server";
import { updateWorkspaceEntry, deleteWorkspaceEntry } from "@/lib/db";
import { logger } from "@/lib/logger";
import { parseBody } from "@/lib/parse-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; entryId: string }> };

/** PATCH /api/projects/[id]/workspace/[entryId] — update a workspace entry */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { entryId } = await context.params;
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

    const entry = await updateWorkspaceEntry(entryId, updates);
    if (!entry) {
      return NextResponse.json({ error: "Workspace entry not found" }, { status: 404 });
    }

    return NextResponse.json({ entry });
  } catch (error: unknown) {
    if (error && typeof error === "object" && "message" in error) {
      const msg = (error as { message: string }).message;
      if (msg.includes("UNIQUE constraint failed") || msg.includes("unique")) {
        return NextResponse.json(
          { error: "An entry with this name already exists in this category" },
          { status: 409 },
        );
      }
    }
    logger.error("Error updating workspace entry", logger.formatError(error));
    return NextResponse.json({ error: "Failed to update workspace entry" }, { status: 500 });
  }
}

/** DELETE /api/projects/[id]/workspace/[entryId] — remove a workspace entry */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { entryId } = await context.params;
    await deleteWorkspaceEntry(entryId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Error deleting workspace entry", logger.formatError(error));
    return NextResponse.json({ error: "Failed to delete workspace entry" }, { status: 500 });
  }
}
