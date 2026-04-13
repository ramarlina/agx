import "server-only";

import { db } from "@/lib/db-instance";
import { LOCAL_USER } from "@/lib/auth-mode";
import { type ProjectObjective, type ProjectObjectiveWorkspaceState } from "@/lib/project-objectives";
import {
  loadProjectObjectiveContext,
  loadProjectObjectiveWorkspace,
  type ProjectObjectiveContext,
} from "@/lib/project-objective-context";
import { getObjectiveRepository } from "@/src/objectives/repository";

export type ProjectObjectiveApiContext = ProjectObjectiveContext;
export { loadProjectObjectiveContext, loadProjectObjectiveWorkspace };

export async function persistProjectObjectiveWorkspace(
  projectId: string,
  currentMetadata: Record<string, unknown> | undefined,
  workspace: ProjectObjectiveWorkspaceState
) {
  const project = await db.getProjectWithRepos(projectId, LOCAL_USER.id);
  const slug = project?.slug ?? projectId;
  const repo = getObjectiveRepository(slug);

  // Always write to files
  repo.writeWorkspace(workspace);

  // Also update DB metadata for backwards compatibility during migration
  const { writeProjectObjectivesWorkspace } = await import("@/lib/project-objectives");
  return db.updateProject(projectId, LOCAL_USER.id, {
    metadata: writeProjectObjectivesWorkspace(currentMetadata ?? {}, workspace),
  });
}

export function findObjectiveAssignedToTeam(
  workspace: ProjectObjectiveWorkspaceState,
  teamId: string,
  excludeObjectiveId?: string
): ProjectObjective | null {
  if (!teamId) return null;
  return (
    workspace.objectives.find(
      (entry) => entry.teamId === teamId && entry.id !== excludeObjectiveId
    ) ?? null
  );
}

export function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function readNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim();
}

export function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    )
  );
}
