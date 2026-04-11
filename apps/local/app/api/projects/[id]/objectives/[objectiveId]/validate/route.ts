import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { db } from "@/lib/db-instance";
import { LOCAL_USER } from "@/lib/auth-mode";
import { getObjectivesDir } from "@/src/objectives/repository";
import { validateObjectiveFile } from "@/src/objectives/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; objectiveId: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { id: projectId, objectiveId } = await params;

  const project = await db.getProjectWithRepos(projectId, LOCAL_USER.id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const slug = project.slug ?? projectId;

  // Find the objective file by scanning for the matching id
  const { getObjectiveRepository } = await import("@/src/objectives/repository");
  const repo = getObjectiveRepository(slug);
  const workspace = repo.readWorkspace();
  const objective = workspace.objectives.find((o) => o.id === objectiveId);

  if (!objective) {
    return NextResponse.json({ error: "Objective not found" }, { status: 404 });
  }

  const filePath = path.join(getObjectivesDir(slug), `${objective.key}.md`);
  const result = validateObjectiveFile(filePath);

  return NextResponse.json({
    filePath,
    objectiveKey: objective.key,
    ...result,
  });
}
