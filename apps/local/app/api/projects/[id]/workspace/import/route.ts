import { NextRequest, NextResponse } from "next/server";
import {
  createWorkspaceEntry,
  getProjectWithRepos,
  getProjectWorkspace,
  getProjectWorkspaceEntries,
  updateWorkspaceEntry,
} from "@/lib/db";
import { logger } from "@/lib/logger";
import { deserializeWorkspace } from "@/lib/workspace-yaml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function workspaceKey(category: string, name: string): string {
  return `${category}\u0000${name}`;
}

/** POST /api/projects/[id]/workspace/import — import workspace map YAML */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectIdOrSlug } = await context.params;
    const project = await getProjectWithRepos(projectIdOrSlug);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const yamlBody = await request.text();
    if (!yamlBody.trim()) {
      return NextResponse.json({ error: "Empty request body" }, { status: 400 });
    }

    let doc;
    try {
      doc = deserializeWorkspace(yamlBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid YAML";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const existingEntries = await getProjectWorkspaceEntries(project.id);
    const existingByKey = new Map(
      existingEntries.map((entry) => [workspaceKey(entry.category, entry.name), entry]),
    );

    const nextSortOrderByCategory = new Map<string, number>();
    let created = 0;
    let updated = 0;

    for (const entry of doc.entries) {
      const key = workspaceKey(entry.category, entry.name);
      const sort_order = nextSortOrderByCategory.get(entry.category) ?? 0;
      nextSortOrderByCategory.set(entry.category, sort_order + 1);

      const existing = existingByKey.get(key);
      if (existing) {
        await updateWorkspaceEntry(project.id, existing.id, {
          purpose: entry.purpose,
          sort_order,
        });
        updated += 1;
        continue;
      }

      await createWorkspaceEntry(project.id, {
        category: entry.category,
        name: entry.name,
        path: null,
        purpose: entry.purpose,
        sort_order,
      });
      created += 1;
    }

    const workspace = await getProjectWorkspace(project.id);
    return NextResponse.json({
      success: true,
      summary: {
        created,
        updated,
        total: doc.entries.length,
      },
      workspace,
    });
  } catch (error) {
    logger.error("Error importing workspace YAML", logger.formatError(error));
    return NextResponse.json({ error: "Failed to import workspace YAML" }, { status: 500 });
  }
}
