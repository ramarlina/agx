"use client";

import { useMemo, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Target, ArrowRight } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { readProjectObjectivesWorkspace, type ProjectObjective } from "@/lib/project-objectives";
import { ObjectiveCard } from "./ObjectiveCard";

interface Team {
  id: string;
  name: string;
}

interface ObjectivesSectionProps {
  projectId: string;
  projectSlug: string;
}

export function ObjectivesSection({ projectId, projectSlug }: ObjectivesSectionProps) {
  const router = useRouter();
  const { projects, isLoading } = useProjects();
  const project = useMemo(
    () => projects.find((p) => p.slug === projectSlug),
    [projects, projectSlug],
  );
  const objectives: ProjectObjective[] = useMemo(
    () => readProjectObjectivesWorkspace(project?.metadata).objectives,
    [project?.metadata],
  );

  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/teams`)
      .then((r) => (r.ok ? r.json() : { teams: [] }))
      .then((data) => setTeams(data.teams ?? []))
      .catch(() => setTeams([]));
  }, [projectId]);

  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);

  const completeCount = objectives.filter((o) => o.progress >= 100).length;

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-[var(--muted)]" />
        ))}
      </div>
    );
  }

  if (objectives.length === 0) {
    return (
      <button
        type="button"
        onClick={() => router.push(`/projects/${projectSlug}/objectives`)}
        className="w-full rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card-bg)] p-6 text-center transition-colors hover:border-[var(--card-hover-border)] hover:bg-[var(--secondary)]"
      >
        <Target className="mx-auto mb-2 h-5 w-5 text-[var(--muted-foreground)]" />
        <span className="text-sm text-[var(--muted-foreground)]">Add your first objective</span>
      </button>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
          <span>{objectives.length} {objectives.length === 1 ? "objective" : "objectives"}</span>
          <span className="text-[var(--border)]">|</span>
          <span>{completeCount}/{objectives.length} complete</span>
        </div>
        <button
          onClick={() => router.push(`/projects/${projectSlug}/objectives`)}
          className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
        >
          View all <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {objectives.map((obj) => (
          <ObjectiveCard
            key={obj.id}
            objective={obj}
            teamName={teamMap.get(obj.teamId) ?? null}
            onClick={() => router.push(`/projects/${projectSlug}/objectives/${encodeURIComponent(obj.id)}`)}
          />
        ))}
      </div>
    </div>
  );
}
