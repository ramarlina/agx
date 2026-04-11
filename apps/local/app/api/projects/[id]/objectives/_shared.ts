import "server-only";

import { db } from "@/lib/db-instance";
import { LOCAL_USER } from "@/lib/auth-mode";
import {
  readProjectObjectivesWorkspace,
  type ProjectObjective,
  type ProjectObjectiveWorkspaceState,
} from "@/lib/project-objectives";
import { getObjectiveRepository } from "@/src/objectives/repository";

export interface ProjectObjectiveApiContext {
  project: NonNullable<Awaited<ReturnType<typeof db.getProjectWithRepos>>>;
  workspace: ProjectObjectiveWorkspaceState;
  objective: ProjectObjective;
}

export async function loadProjectObjectiveContext(
  projectId: string,
  objectiveId: string
): Promise<ProjectObjectiveApiContext | null> {
  const project = await db.getProjectWithRepos(projectId, LOCAL_USER.id);
  if (!project) {
    return null;
  }

  const workspace = loadWorkspace(project);
  const objective = workspace.objectives.find((entry) => entry.id === objectiveId) ?? null;
  if (!objective) {
    return null;
  }

  return {
    project,
    workspace,
    objective,
  };
}

function loadWorkspace(
  project: NonNullable<Awaited<ReturnType<typeof db.getProjectWithRepos>>>,
): ProjectObjectiveWorkspaceState {
  const slug = project.slug ?? project.id;
  const repo = getObjectiveRepository(slug);

  // Primary: read from frontmatter files
  if (repo.hasFiles()) {
    return repo.readWorkspace();
  }

  // Fallback: read from database metadata (dual-read migration)
  return readProjectObjectivesWorkspace(project.metadata);
}

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
