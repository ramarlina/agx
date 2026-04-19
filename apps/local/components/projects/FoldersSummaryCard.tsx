"use client";

import { ArrowRight, FolderGit2, FolderOpen } from "lucide-react";
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace";
import { buildWorkspaceCategoryGroups } from "@/lib/project-workspace";

interface FoldersSummaryCardProps {
  projectId: string;
  onViewAll?: () => void;
}

export function FoldersSummaryCard({ projectId, onViewAll }: FoldersSummaryCardProps) {
  const { workspace, entryCount, isLoading, error } = useProjectWorkspace(projectId);
  const visibleGroups = buildWorkspaceCategoryGroups(workspace).filter((group) => group.entries.length > 0).slice(0, 3);

  return (
    <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderGit2 className="h-4 w-4 text-[var(--muted-foreground)]" />
          <span className="text-sm font-medium text-[var(--foreground)]">Workspace Map</span>
          {entryCount > 0 && (
            <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
              {entryCount}
            </span>
          )}
        </div>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            View all <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {isLoading && (
        <p className="text-sm text-[var(--muted-foreground)]">Loading workspace map...</p>
      )}

      {!isLoading && error && (
        <p className="text-sm text-[var(--destructive)]">Unable to load the workspace map right now.</p>
      )}

      {!isLoading && !error && entryCount === 0 && (
        <p className="text-sm text-[var(--muted-foreground)]">
          No workspace locations mapped yet. Add repositories, docs, or scripts so agents know where to work.
        </p>
      )}

      {!isLoading && !error && entryCount > 0 && (
        <div className="space-y-3">
          {visibleGroups.map((group) => (
            <div key={group.id} className="rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                  {group.label}
                </span>
                <span className="text-[11px] text-[var(--muted-foreground)]">{group.entries.length}</span>
              </div>
              <div className="space-y-2">
                {group.entries.slice(0, 2).map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2 text-sm">
                    <FolderOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[var(--foreground)]">{entry.name}</div>
                      <div className="truncate text-xs text-[var(--muted-foreground)]">
                        {entry.path || entry.purpose || "No path set yet"}
                      </div>
                    </div>
                  </div>
                ))}
                {group.entries.length > 2 && (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    + {group.entries.length - 2} more
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
