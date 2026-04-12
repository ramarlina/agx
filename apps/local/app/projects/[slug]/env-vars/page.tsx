"use client";

import { use } from "react";
import { EnvironmentVariablesView } from "@/components/projects/EnvironmentVariablesView";
import { useProjectsWithAgents } from "@/hooks/useProjects";

export default function EnvVarsPage({
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

  return <EnvironmentVariablesView projectId={project.id} />;
}
