"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { ProjectHome } from "@/components/projects/ProjectHome";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { useProjectsWithAgents } from "@/hooks/useProjects";

type ProjectPageClientProps = {
  slug: string;
};

export function ProjectPageClient({ slug }: ProjectPageClientProps) {
  const { projects } = useProjectsWithAgents();
  const project = projects.find((p) => p.slug === slug);

  const [teamState, setTeamState] = useState<"loading" | "empty" | "has-teams">("loading");

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/teams`, { cache: "no-store" });
        if (cancelled) return;
        const data = res.ok ? await res.json() : { teams: [] };
        const teams = Array.isArray(data?.teams) ? data.teams : [];
        setTeamState(teams.length === 0 ? "empty" : "has-teams");
      } catch {
        if (!cancelled) setTeamState("has-teams");
      }
    })();
    return () => { cancelled = true; };
  }, [project]);

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-zinc-500">
        Loading project...
      </div>
    );
  }

  if (teamState === "empty") {
    return (
      <EmptyStateCard
        icon={<Users className="w-6 h-6 text-[var(--foreground)]" />}
        title={`Add a team to ${project.name}`}
        description="Teams are the agents that work through your tickets and PRs. Add one to start shipping."
        ctaLabel="Add a team"
        ctaHref={`/projects/${project.slug}/teams/new`}
      />
    );
  }

  return (
    <ProjectHome
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
