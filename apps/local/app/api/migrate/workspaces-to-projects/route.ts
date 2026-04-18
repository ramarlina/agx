import { NextResponse } from "next/server";
import { getSQLiteDb } from "@/lib/sqlite-query-adapter";
import {
  getLegacyWorkspaceSourceCounts,
  getLegacyWorkspaceMigrationStatus,
  migrateLegacyWorkspacesToProjects,
} from "@/lib/workspaces-to-projects-migration";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = migrateLegacyWorkspacesToProjects(getSQLiteDb());
    return NextResponse.json({ message: "Workspace to project migration complete", result });
  } catch (error) {
    logger.error("Workspace migration error", logger.formatError(error));
    return NextResponse.json(
      { error: "Migration failed", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const db = getSQLiteDb();
    const migrationStatus = getLegacyWorkspaceMigrationStatus(db);
    const legacyCounts = getLegacyWorkspaceSourceCounts(db);
    const counts = {
      ...legacyCounts,
      agents: (db.prepare("SELECT COUNT(*) AS n FROM agents").get() as { n: number }).n,
      agentSkills: (db.prepare("SELECT COUNT(*) AS n FROM agent_skills").get() as { n: number }).n,
      projects: (db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n,
      projectAgents: (db.prepare("SELECT COUNT(*) AS n FROM project_agents").get() as { n: number }).n,
      projectThreads: (db.prepare("SELECT COUNT(*) AS n FROM project_threads").get() as { n: number }).n,
      projectSkills: (db.prepare("SELECT COUNT(*) AS n FROM project_skills").get() as { n: number }).n,
      projectVariables: (db.prepare("SELECT COUNT(*) AS n FROM project_variables").get() as { n: number }).n,
    };

    return NextResponse.json({
      ...counts,
      migrated: counts.agents > 0 && counts.projectAgents > 0,
      autoMigration: migrationStatus,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
