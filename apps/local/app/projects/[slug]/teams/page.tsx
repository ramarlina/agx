"use client";

import { use } from "react";
import { TeamsView } from "@/components/projects/TeamsView";
import { useProjectsWithAgents } from "@/hooks/useProjects";

export default function TeamsPage({
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
        Loading...
      </div>
    );
  }

  return (
    <TeamsView
      projectId={project.id}
      projectSlug={project.slug}
      projectAgents={project.agents}
    />
  );
}
