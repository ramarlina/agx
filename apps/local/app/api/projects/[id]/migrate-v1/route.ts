import { NextRequest, NextResponse } from "next/server";
import { createDbServerClientWithRequest } from "@/lib/db-server";
import { getProjectWithRepos, getTasks } from "@/lib/db";
import { restoreProjectTasksFromMigration } from "@/src/graph/migration-job";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const db = await createDbServerClientWithRequest(request);
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const project = await getProjectWithRepos(projectId, user.id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tasks = await getTasks(user.id, { project: project.slug });
  const taskIds = tasks.map((t: { id: string }) => t.id);

  const result = await restoreProjectTasksFromMigration({ projectId, taskIds });
  return NextResponse.json(result);
}
