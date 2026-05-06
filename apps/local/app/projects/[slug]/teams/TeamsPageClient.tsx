"use client";

import { TeamsView } from "@/components/projects/TeamsView";
import { useProjectsWithAgents } from "@/hooks/useProjects";

type TeamsPageClientProps = {
  slug: string;
};

export function TeamsPageClient({ slug }: TeamsPageClientProps) {
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
      projectThreadIds={project.thread_ids}
    />
  );
}
