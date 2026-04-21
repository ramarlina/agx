import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-instance";
import { buildProjectInput, InvalidProjectPayloadError } from "./payload";
import { LOCAL_USER } from "@/lib/auth-mode";
import { hydrateProjectsObjectiveMetadata } from "./objective-metadata";
import { logger } from "@/lib/logger";

function isMissingProjectsSchemaError(error: unknown): boolean {
// ... (rest of helper)
  if (!error || typeof error !== "object") return false;

  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("relation \"projects\" does not exist") ||
    message.includes("Could not find the table 'agx.projects'") ||
    message.includes("Could not find the table 'public.projects'")
  );
}

// GET /api/projects - list the authenticated user's projects
export async function GET(request: NextRequest) {
  try {
    const userId = LOCAL_USER.id;
    const includeArchived = request.nextUrl.searchParams.get("archived") === "true";

    const projects = await db.getProjects(userId, includeArchived);
    return NextResponse.json({
      projects: hydrateProjectsObjectiveMetadata(projects),
    });
  } catch (error) {
    logger.error("Error fetching projects", logger.formatError(error));
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

// POST /api/projects - create a new project with optional repos
export async function POST(request: NextRequest) {
  try {
    const userId = LOCAL_USER.id;

    const rawBody = await request.json();
    if (!rawBody || typeof rawBody !== "object") {
      return NextResponse.json({ error: "Invalid project payload" }, { status: 400 });
    }

    const projectInput = buildProjectInput(rawBody as Record<string, unknown>);

    if (!projectInput.name) {
      return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    }

    const project = await db.createProject(userId, projectInput);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidProjectPayloadError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    logger.error("Error creating project", logger.formatError(error));
    if (isMissingProjectsSchemaError(error)) {
      return NextResponse.json(
        {
          error: "Projects schema is not available. Run Db migrations to create agx.projects and agx.project_repos.",
          code: "SCHEMA_NOT_READY",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
