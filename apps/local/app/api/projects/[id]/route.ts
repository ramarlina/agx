import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-instance";
import { buildProjectUpdatePayload, InvalidProjectPayloadError } from "../payload";
import { LOCAL_USER } from "@/lib/auth-mode";
import { PROJECT_OBJECTIVES_METADATA_KEY, readProjectObjectivesWorkspace } from "@/lib/project-objectives";
import { getObjectiveRepository } from "@/src/objectives/repository";
import { ensureObjectiveWorkerJob } from "@/src/prompt-scheduler/objective-worker-job";
import { hydrateProjectObjectiveMetadata } from "../objective-metadata";
import { logger } from "@/lib/logger";

type ParamsArg = Promise<{ id: string }>;

async function resolveParams(params: ParamsArg) {
  const resolved = await Promise.resolve(params);
  if (!resolved || typeof resolved.id !== "string") return null;
  const trimmed = resolved.id.trim();
  return trimmed || null;
}

async function getRequestUser(_request: NextRequest) {
  return { db: null, user: { id: LOCAL_USER.id }, error: null };
}

export async function GET(request: NextRequest, { params }: { params: ParamsArg }) {
  try {
    const { user, error } = await getRequestUser(request);
    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = await resolveParams(params);
    if (!projectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const project = await db.getProjectWithRepos(projectId, user.id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({ project: hydrateProjectObjectiveMetadata(project) });
  } catch (err) {
    logger.error("Error fetching project", logger.formatError(err));
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: ParamsArg }) {
  try {
    const { user, error } = await getRequestUser(request);
    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = await resolveParams(params);
    if (!projectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 400 });
    }

    const rawBody = await request.json();
    if (!rawBody || typeof rawBody !== "object") {
      return NextResponse.json({ error: "Invalid project payload" }, { status: 400 });
    }

    const updates = buildProjectUpdatePayload(rawBody as Record<string, unknown>);
    if (!Object.keys(updates).length) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const project = await db.updateProject(projectId, user.id, updates);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Sync objectives to frontmatter files when metadata is updated
    if (updates.metadata && updates.metadata[PROJECT_OBJECTIVES_METADATA_KEY]) {
      try {
        const slug = project.slug ?? projectId;
        const repo = getObjectiveRepository(slug);
        const workspace = readProjectObjectivesWorkspace(updates.metadata);
        repo.writeWorkspace(workspace);

        for (const objective of workspace.objectives) {
          try {
            ensureObjectiveWorkerJob({
              projectId,
              objectiveId: objective.id,
              objectiveKey: objective.key,
            });
          } catch {
            // Worker job creation is best-effort
          }
        }
      } catch (error) {
        logger.error("[objectives] failed to sync to files", logger.formatError(error));
      }
    }

    return NextResponse.json({ project: hydrateProjectObjectiveMetadata(project) });
  } catch (err) {
    if (err instanceof InvalidProjectPayloadError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    logger.error("Error updating project", logger.formatError(err));
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: ParamsArg }) {
  try {
    const { user, error } = await getRequestUser(request);
    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = await resolveParams(params);
    if (!projectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    await db.deleteProject(projectId, user.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Error deleting project", logger.formatError(err));
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
