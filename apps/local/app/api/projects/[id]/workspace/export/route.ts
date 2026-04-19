import { NextRequest, NextResponse } from "next/server";
import { getProjectWithRepos, getProjectWorkspaceEntries } from "@/lib/db";
import { logger } from "@/lib/logger";
import { serializeWorkspace } from "@/lib/workspace-yaml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/projects/[id]/workspace/export — export workspace map YAML */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id: projectIdOrSlug } = await context.params;
    const project = await getProjectWithRepos(projectIdOrSlug);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const entries = await getProjectWorkspaceEntries(project.id);
    const yaml = serializeWorkspace(entries);
    const filename = `workspace-${project.slug || project.id}.yaml`;

    return new NextResponse(yaml, {
      status: 200,
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    logger.error("Error exporting workspace YAML", logger.formatError(error));
    return NextResponse.json({ error: "Failed to export workspace YAML" }, { status: 500 });
  }
}
