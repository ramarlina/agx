import { writeProjectObjectivesWorkspace } from "@/lib/project-objectives";
import { getObjectiveRepository } from "@/src/objectives/repository";
import { logger } from "@/lib/logger";

type ProjectWithMetadata = {
  id: string;
  slug?: string | null;
  metadata?: Record<string, unknown> | null;
};

export function hydrateProjectObjectiveMetadata<T extends ProjectWithMetadata>(project: T): T {
  const slug = typeof project.slug === "string" && project.slug.trim() ? project.slug.trim() : project.id;

  try {
    const repo = getObjectiveRepository(slug);
    if (!repo.hasFiles()) {
      return project;
    }

    const workspace = repo.readWorkspace();
    return {
      ...project,
      metadata: writeProjectObjectivesWorkspace(project.metadata ?? {}, workspace),
    };
  } catch (error) {
    logger.error("[objectives] failed to hydrate project metadata from files", logger.formatError(error));
    return project;
  }
}

export function hydrateProjectsObjectiveMetadata<T extends ProjectWithMetadata>(projects: T[]): T[] {
  return projects.map((project) => hydrateProjectObjectiveMetadata(project));
}
