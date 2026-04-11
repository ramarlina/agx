"use client";

import { use } from "react";
import { ProjectOverview } from "@/components/projects/ProjectOverview";
import { useProjectsWithAgents } from "@/hooks/useProjects";

export default function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { projects } = useProjectsWithAgents();
  const project = projects.find((p) => p.slug === slug);

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-zinc-500">
        Loading project...
      </div>
    );
  }

  return (
    <ProjectOverview
      projectId={project.id}
      projectSlug={project.slug}
      projectName={project.name}
      projectDescription={project.description}
      projectMetadata={project.metadata}
      repos={project.repos}
      threadIds={project.thread_ids}
    />
  );
}
