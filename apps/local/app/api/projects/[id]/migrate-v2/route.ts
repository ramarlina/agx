import { NextRequest, NextResponse } from "next/server";
import { createDbServerClientWithRequest } from "@/lib/db-server";
import { getProjectWithRepos, getTasks } from "@/lib/db";
import { parseBody } from "@/lib/parse-body";
import {
  backupProjectTasksForMigration,
  runV1ToV2MigrationJob,
} from "@/src/graph/migration-job";

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

  const parsed = await parseBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const dryRun = body.dryRun ?? false;

  const tasks = await getTasks(user.id, { project: project.slug });
  const taskIds = tasks.map((t: { id: string }) => t.id);

  if (taskIds.length === 0) {
    return NextResponse.json({
      processed: 0,
      migrated: 0,
      skipped: 0,
      failed: 0,
      dryRun,
      projectSlug: project.slug,
    });
  }

  await backupProjectTasksForMigration({ projectId, taskIds });
  const result = await runV1ToV2MigrationJob({ dryRun, taskIds });

  return NextResponse.json({
    ...(result as any),
    projectSlug: project.slug,
    dryRun,
  });
}
