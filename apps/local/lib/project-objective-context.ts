import "server-only";

import { db } from "@/lib/db-instance";
import { LOCAL_USER } from "@/lib/auth-mode";
import {
  readProjectObjectivesWorkspace,
  writeProjectHealthSnapshot,
  writeProjectObjectivesWorkspace,
  type ProjectHealthSnapshot,
  type ProjectObjective,
  type ProjectObjectiveWorkspaceState,
} from "@/lib/project-objectives";
import { getObjectiveRepository } from "@/src/objectives/repository";

export interface ProjectObjectiveContext {
  project: NonNullable<Awaited<ReturnType<typeof db.getProjectWithRepos>>>;
  workspace: ProjectObjectiveWorkspaceState;
  objective: ProjectObjective;
}

export async function loadProjectObjectiveContext(
  projectId: string,
  objectiveId: string
): Promise<ProjectObjectiveContext | null> {
  const project = await db.getProjectWithRepos(projectId, LOCAL_USER.id);
  if (!project) {
    return null;
  }

  const workspace = loadProjectObjectiveWorkspace(project);
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

export function loadProjectObjectiveWorkspace(
  project: NonNullable<Awaited<ReturnType<typeof db.getProjectWithRepos>>>
): ProjectObjectiveWorkspaceState {
  const slug = project.slug ?? project.id;
  const repo = getObjectiveRepository(slug);

  if (repo.hasFiles()) {
    return repo.readWorkspace();
  }

  return readProjectObjectivesWorkspace(project.metadata);
}

export async function persistProjectObjectiveWorkspace(input: {
  projectId: string;
  currentMetadata: Record<string, unknown> | undefined;
  workspace: ProjectObjectiveWorkspaceState;
  transformMetadata?: (metadata: Record<string, unknown>) => Record<string, unknown>;
}) {
  const project = await db.getProjectWithRepos(input.projectId, LOCAL_USER.id);
  const slug = project?.slug ?? input.projectId;
  const repo = getObjectiveRepository(slug);

  repo.writeWorkspace(input.workspace);

  const nextMetadataBase = writeProjectObjectivesWorkspace(
    input.currentMetadata ?? {},
    input.workspace,
  );
  const nextMetadata = input.transformMetadata
    ? input.transformMetadata(nextMetadataBase)
    : nextMetadataBase;

  return db.updateProject(input.projectId, LOCAL_USER.id, {
    metadata: nextMetadata,
  });
}

export async function persistProjectHealthSnapshot(input: {
  projectId: string;
  currentMetadata: Record<string, unknown> | undefined;
  snapshot: ProjectHealthSnapshot;
}) {
  return db.updateProject(input.projectId, LOCAL_USER.id, {
    metadata: writeProjectHealthSnapshot(input.currentMetadata ?? {}, input.snapshot),
  });
}

export async function persistProjectObjectiveMetadata(input: {
  projectId: string;
  currentMetadata: Record<string, unknown> | undefined;
  transformMetadata: (metadata: Record<string, unknown>) => Record<string, unknown>;
}) {
  return db.updateProject(input.projectId, LOCAL_USER.id, {
    metadata: input.transformMetadata(input.currentMetadata ?? {}),
  });
}
