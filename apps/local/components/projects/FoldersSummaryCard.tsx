"use client";

import { FolderGit2, ArrowRight } from "lucide-react";

interface Repo {
  id: string;
  name: string;
  path?: string;
  git_url?: string;
}

interface FoldersSummaryCardProps {
  repos: Repo[];
  onViewAll?: () => void;
}

export function FoldersSummaryCard({ repos, onViewAll }: FoldersSummaryCardProps) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FolderGit2 className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">Repositories</span>
          {repos.length > 0 && (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {repos.length}
            </span>
          )}
        </div>
        {onViewAll && (
          <button onClick={onViewAll} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
            View all <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {repos.length === 0 ? (
        <p className="text-sm text-zinc-500">No repositories linked</p>
      ) : (
        <div className="space-y-2">
          {repos.slice(0, 5).map((repo) => (
            <div key={repo.id} className="flex items-center gap-2 text-sm">
              <FolderGit2 className="w-4 h-4 text-zinc-500 shrink-0" />
              <span className="text-zinc-300 truncate">{repo.name}</span>
              {repo.path && (
                <span className="text-zinc-500 text-xs truncate ml-auto">{repo.path}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
