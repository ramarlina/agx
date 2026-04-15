"use client";

import { ProjectWithRepos } from "@/hooks/useProjects";
import {
  PROJECT_OBJECTIVES_METADATA_KEY,
  LEGACY_PROJECT_GOALS_METADATA_KEY,
  PROJECT_HEALTH_METADATA_KEY,
} from "@/lib/project-objectives";

interface ProjectCardProps {
  project: ProjectWithRepos;
  onEdit?: (project: ProjectWithRepos) => void;
  onDelete?: (project: ProjectWithRepos) => void;
  onClick?: (project: ProjectWithRepos) => void;
  onManageTasks?: (project: ProjectWithRepos) => void;
}

const INTERNAL_METADATA_KEYS = new Set([
  PROJECT_OBJECTIVES_METADATA_KEY,
  LEGACY_PROJECT_GOALS_METADATA_KEY,
  PROJECT_HEALTH_METADATA_KEY,
]);

function formatMetadata(metadata: Record<string, unknown>) {
  return Object.entries(metadata ?? {})
    .filter(([key]) => key !== "undefined" && key !== "" && !INTERNAL_METADATA_KEYS.has(key))
    .map(([key, value]) => (
      <div key={key} className="text-[12px] text-[var(--muted-foreground)] flex justify-between">
        <span className="font-semibold">{key}</span>
        <span className="truncate text-right">
          {typeof value === "string" ? value : JSON.stringify(value)}
        </span>
      </div>
    ));
}

export default function ProjectCard({ project, onEdit, onDelete, onClick, onManageTasks }: ProjectCardProps) {
  const hasRepos = project.repos && project.repos.length > 0;

  return (
    <div 
      onClick={() => onClick?.(project)}
      className={`p-5 surface-card space-y-4
        ${onClick ? "cursor-pointer hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-md active:scale-[0.99]" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">{project.name}</h3>
          <p className="text-xs text-[var(--muted-foreground)] tracking-wide uppercase">
            {project.slug}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">
            Updated {new Date(project.updated_at).toLocaleDateString()}
          </span>
                  {(onEdit || onDelete || onManageTasks) && (
                    <div className="flex items-center gap-2">
                      {onManageTasks && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onManageTasks(project);
                          }}
                          className="text-[11px] font-semibold px-2 py-1 rounded-full border border-[var(--card-border)] bg-[var(--background)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-all"
                        >
                          Tasks
                        </button>
                      )}
                      {onEdit && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(project);
                          }}
                          className="text-[11px] font-semibold px-2 py-1 rounded-full border border-[var(--card-border)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-all bg-[var(--background)]"
                        >
                          Edit
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(project);
                          }}
                          className="text-[11px] font-semibold px-2 py-1 rounded-full border border-[var(--card-border)] text-[var(--destructive)] hover:border-[var(--destructive)] transition-all bg-[var(--background)]"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
        </div>
      </div>

      {project.description && (
        <p className="text-sm text-[var(--foreground)] line-clamp-2">{project.description}</p>
      )}

      {project.ci_cd_info && (
        <div className="text-sm">
          <p className="text-[var(--muted-foreground)] text-[12px] uppercase tracking-wide">CI / CD</p>
          <p className="text-[14px] text-[var(--accent)] font-medium truncate">{project.ci_cd_info}</p>
        </div>
      )}

      {project.metadata && Object.keys(project.metadata).some((key) => !INTERNAL_METADATA_KEYS.has(key)) && (
        <div className="p-3 rounded-lg bg-[var(--muted)]/20 border border-dashed border-[var(--card-border)] space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Metadata
          </p>
          <div className="space-y-1">
            {formatMetadata(project.metadata)}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <span className="text-[12px] uppercase tracking-wider text-[var(--muted-foreground)]">
            Folders
          </span>
          <span className="text-[12px] text-[var(--muted-foreground)]">
            {hasRepos ? `${project.repos.length} connected` : "Unlinked"}
          </span>
        </div>

        {!hasRepos ? (
          <p className="mt-3 text-[12px] text-[var(--muted-foreground)]">No folders added yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {project.repos.slice(0, 2).map((repo) => (
              <div
                key={repo.id}
                className="p-2 rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[11px]"
              >
                <div className="font-semibold truncate">{repo.name}</div>
                {repo.path && <p className="text-[10px] text-[var(--muted-foreground)] truncate">{repo.path}</p>}
              </div>
            ))}
            {project.repos.length > 2 && (
              <p className="text-[10px] text-center text-[var(--muted-foreground)]">
                + {project.repos.length - 2} more
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
