"use client";

import { useMemo } from "react";
import { Target, ArrowRight } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import {
  readProjectObjectivesWorkspace,
  type ProjectObjective,
} from "@/lib/project-objectives";

interface ObjectivesSummaryCardProps {
  projectSlug: string;
  onViewAll?: () => void;
}

export function ObjectivesSummaryCard({ projectSlug, onViewAll }: ObjectivesSummaryCardProps) {
  const { projects, isLoading } = useProjects();
  const project = useMemo(
    () => projects.find((p) => p.slug === projectSlug),
    [projects, projectSlug],
  );
  const objectives: ProjectObjective[] = useMemo(
    () => readProjectObjectivesWorkspace(project?.metadata).objectives,
    [project?.metadata],
  );
  const completeCount = objectives.filter((o) => o.progress >= 100).length;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">Objectives</span>
          {!isLoading && objectives.length > 0 && (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {completeCount}/{objectives.length} complete
            </span>
          )}
        </div>
        {onViewAll && (
          <button onClick={onViewAll} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
            View all <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-5 rounded bg-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : objectives.length === 0 ? (
        <p className="text-sm text-zinc-500">No objectives set</p>
      ) : (
        <div className="space-y-3">
          {objectives.slice(0, 4).map((obj) => (
            <div key={obj.id}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-zinc-300 truncate">{obj.title}</span>
                <span className="text-zinc-500 text-xs ml-2 shrink-0">{obj.progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500/70 transition-all"
                  style={{ width: `${Math.min(obj.progress, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
