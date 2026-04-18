import { NextRequest, NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import {
  getProjectWorkspace,
  createWorkspaceEntry,
  getProjectWithRepos,
} from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function isUniqueConstraintError(error: unknown): boolean {
  if (error instanceof ConflictError) return true;
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (code === "SQLITE_CONSTRAINT_UNIQUE") return true;
  }
  return false;
}

/** GET /api/projects/[id]/workspace — list entries grouped by category */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const workspace = await getProjectWorkspace(projectId);
    return NextResponse.json({ workspace });
  } catch (error) {
    logger.error("Error fetching workspace", logger.formatError(error));
    return NextResponse.json({ error: "Failed to fetch workspace" }, { status: 500 });
  }
}

/** POST /api/projects/[id]/workspace — create a workspace entry */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const parsed = await parseBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const category = typeof body.category === "string" ? body.category.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!category || !name) {
      return NextResponse.json(
        { error: "category and name are required" },
        { status: 400 },
      );
    }

    const project = await getProjectWithRepos(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const path = typeof body.path === "string" ? body.path.trim() || null : null;
    const purpose = typeof body.purpose === "string" ? body.purpose.trim() || null : null;

    const entry = await createWorkspaceEntry(project.id, { category, name, path, purpose });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: "An entry with this name already exists in this category" },
        { status: 409 },
      );
    }
    logger.error("Error creating workspace entry", logger.formatError(error));
    return NextResponse.json({ error: "Failed to create workspace entry" }, { status: 500 });
  }
}
