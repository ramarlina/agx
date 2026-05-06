"use client";

import { FoldersView } from "@/components/projects/FoldersView";
import { useProjectsWithAgents } from "@/hooks/useProjects";

type FoldersPageClientProps = {
  slug: string;
};

export function FoldersPageClient({ slug }: FoldersPageClientProps) {
  const { projects } = useProjectsWithAgents();
  const project = projects.find((p) => p.slug === slug);

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-zinc-500">
        Loading...
      </div>
    );
  }

  return <FoldersView projectId={project.id} />;
}
