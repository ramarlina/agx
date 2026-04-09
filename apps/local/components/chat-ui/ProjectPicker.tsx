"use client";

import { useEffect, useState, useCallback } from "react";
import type { AgxProject } from "@/types/tasks";
import { listProjects, createProject } from "@/services/agxService";
import { Loader2, FolderOpen, Plus, X, AlertTriangle } from "lucide-react";

interface Props {
  onSelect: (projectId: string, projectName: string) => void;
  onClose: () => void;
}

export function ProjectPicker({ onSelect, onClose }: Props) {
  const [projects, setProjects] = useState<AgxProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const p = await listProjects();
        setProjects(p);
      } catch (err) {
        if (err instanceof Error && err.message === "SCHEMA_NOT_READY") {
          setError("agx-cloud database not ready. Run migrations first.");
        } else {
          setError("Failed to load projects. Is agx-cloud running?");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleCreate = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const project = await createProject(name);
      onSelect(project.id, project.name);
    } catch (err) {
      setError("Failed to create project");
    } finally {
      setCreating(false);
    }
  }, [newProjectName, onSelect]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <div className="bg-[var(--app-shell-elevated)] rounded-2xl shadow-xl border border-[var(--app-shell-border)] w-full max-w-sm mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--app-shell-border)]">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-[var(--app-shell-muted)]" />
            <h3 className="text-sm font-bold text-[var(--foreground)]">Select Project</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[var(--app-shell-muted)] hover:text-[var(--foreground)] rounded-md hover:bg-[var(--app-shell-subtle)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 max-h-64 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-[var(--app-shell-muted)] animate-spin" />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg text-amber-700 text-xs font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {!loading && !error && projects.length === 0 && (
            <p className="text-xs text-[var(--app-shell-muted)] text-center py-4">
              No projects found. Create one below.
            </p>
          )}

          {!loading &&
            projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p.id, p.name)}
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-[var(--app-shell-subtle)] transition-colors flex items-center gap-3 group"
              >
                <div className="w-8 h-8 rounded-lg bg-[var(--app-shell-subtle)] flex items-center justify-center shrink-0">
                  <FolderOpen className="w-4 h-4 text-[var(--app-shell-muted)] group-hover:text-[var(--foreground)]" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--foreground)] truncate">
                    {p.name}
                  </div>
                  {p.description && (
                    <div className="text-[11px] text-[var(--app-shell-muted)] truncate">
                      {p.description}
                    </div>
                  )}
                </div>
              </button>
            ))}
        </div>

        <div className="px-4 pb-4 pt-2 border-t border-[var(--app-shell-border)]">
          {showCreateForm ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="Project name"
                autoFocus
                className="flex-1 h-8 px-3 text-sm bg-[var(--input)] border border-[var(--app-shell-border)] rounded-lg outline-none focus:ring-1 focus:ring-[var(--ring)] text-[var(--foreground)]"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating || !newProjectName.trim()}
                className="h-8 px-3 text-xs font-bold text-[var(--primary-foreground)] bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg disabled:opacity-40"
              >
                {creating ? "…" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="h-8 px-2 text-[var(--app-shell-muted)] hover:text-[var(--foreground)]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-1.5 text-xs font-bold text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              <Plus className="w-3.5 h-3.5" />
              Create new project
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
