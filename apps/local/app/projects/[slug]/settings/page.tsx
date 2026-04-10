"use client";

import { use } from "react";
import { ProjectSettings } from "@/components/projects/ProjectSettings";
import { useProjectsWithAgents } from "@/hooks/useProjects";

export default function SettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { projects, updateProject, deleteProject } = useProjectsWithAgents();
  const project = projects.find((p) => p.slug === slug);

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-zinc-500">
        Loading...
      </div>
    );
  }

  return (
    <ProjectSettings
      project={project}
      onUpdate={updateProject}
      onDelete={deleteProject}
    />
  );
}
