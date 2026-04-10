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
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">Teams</span>
          {!loading && teams.length > 0 && (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {teams.length}
            </span>
          )}
        </div>
        {onViewAll && (
          <button onClick={onViewAll} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
            View all <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-5 rounded bg-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : teams.length === 0 ? (
        <p className="text-sm text-zinc-500">No teams yet</p>
      ) : (
        <div className="space-y-2">
          {teams.slice(0, 5).map((team) => (
            <div key={team.id} className="flex items-center gap-2 text-sm">
              <Users className="w-4 h-4 text-zinc-500" />
              <span className="text-zinc-300">{team.name}</span>
              <span className="text-zinc-500">{team.agents.length} agents</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
