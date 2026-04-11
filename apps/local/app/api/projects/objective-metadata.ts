import { writeProjectObjectivesWorkspace } from "@/lib/project-objectives";
import { getObjectiveRepository } from "@/src/objectives/repository";

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
    console.error("[objectives] failed to hydrate project metadata from files:", error);
    return project;
  }
}

export function hydrateProjectsObjectiveMetadata<T extends ProjectWithMetadata>(projects: T[]): T[] {
  return projects.map((project) => hydrateProjectObjectiveMetadata(project));
}
