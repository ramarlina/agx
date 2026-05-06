"use client";

import { useProjects } from "@/hooks/useProjects";
import PromptJobBoard from "@/components/PromptJobBoard";

type ProjectAutomationsPageClientProps = {
  slug: string;
};

export function ProjectAutomationsPageClient({ slug }: ProjectAutomationsPageClientProps) {
  const { projects, isLoading } = useProjects();
  const project = projects.find((p) => p.slug === slug);

  if (isLoading) {
    return (
      <div className="px-6 py-6 text-sm text-[var(--muted-foreground)]">
        Loading automations...
      </div>
    );
  }

  if (!project) {
    return (
      <div className="px-6 py-6 text-sm text-[var(--muted-foreground)]">
        Project not found.
      </div>
    );
  }

  return <PromptJobBoard projectId={project.id} requireProjectId />;
}
