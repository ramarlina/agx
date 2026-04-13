"use client";

import { useEffect, useState } from "react";
import { Users, ArrowRight } from "lucide-react";

interface Team {
  id: string;
  name: string;
  agents: Array<{ id: string }>;
}

interface TeamsSummaryCardProps {
  projectId: string;
  onViewAll?: () => void;
}

export function TeamsSummaryCard({ projectId, onViewAll }: TeamsSummaryCardProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/teams`)
      .then((r) => (r.ok ? r.json() : { teams: [] }))
      .then((data) => setTeams(data.teams ?? []))
      .catch(() => setTeams([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  return (
    <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[var(--muted-foreground)]" />
          <span className="text-sm font-medium text-[var(--foreground)]">Teams</span>
          {!loading && teams.length > 0 && (
            <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
              {teams.length}
            </span>
          )}
        </div>
        {onViewAll && (
          <button onClick={onViewAll} className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]">
            View all <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-[var(--muted)]" />
          ))}
        </div>
      ) : teams.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No teams yet</p>
      ) : (
        <div className="space-y-2">
          {teams.slice(0, 5).map((team) => (
            <div key={team.id} className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-[var(--muted-foreground)]" />
              <span className="text-[var(--foreground)]">{team.name}</span>
              <span className="text-[var(--muted-foreground)]">{team.agents.length} agents</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
