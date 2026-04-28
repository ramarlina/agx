"use client";

import { use } from "react";
import { FoldersView } from "@/components/projects/FoldersView";
import { useProjectsWithAgents } from "@/hooks/useProjects";

export default function FoldersPage({
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
    <FoldersView
      projectId={project.id}
      projectSlug={project.slug}
      projectName={project.name}
    />
  );
}
