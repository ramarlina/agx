import "server-only";

import { db } from "@/lib/db-instance";
import { LOCAL_USER } from "@/lib/auth-mode";
import {
  readProjectObjectivesWorkspace,
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
