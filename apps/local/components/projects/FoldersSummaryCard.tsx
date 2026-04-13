"use client";

import { useEffect, useState } from "react";
import { FolderGit2, ArrowRight, Pencil, Plus, Trash2, X } from "lucide-react";
import { useProjects, type ProjectRepoInput } from "@/hooks/useProjects";

interface Repo {
  id: string;
  name: string;
  path?: string;
  git_url?: string;
}

interface FoldersSummaryCardProps {
  projectId: string;
  repos: Repo[];
  onViewAll?: () => void;
}

export function FoldersSummaryCard({ projectId, repos, onViewAll }: FoldersSummaryCardProps) {
  const { updateProject } = useProjects();
  const [items, setItems] = useState(repos);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftPath, setDraftPath] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setItems(repos);
  }, [repos]);

  const setFeedback = (message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 2500);
  };

  const toPayload = (nextRepos: Repo[]): ProjectRepoInput[] =>
    nextRepos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      path: repo.path,
      git_url: repo.git_url,
    }));

  const resetDraft = () => {
    setDraftName("");
    setDraftPath("");
    setEditingId(null);
    setIsAdding(false);
  };

  const startAdd = () => {
    setEditingId(null);
    setDraftName("");
    setDraftPath("");
    setIsAdding(true);
  };

  const startEdit = (repo: Repo) => {
    setIsAdding(false);
    setEditingId(repo.id);
    setDraftName(repo.name);
    setDraftPath(repo.path ?? "");
  };

  const handleSaveNew = async () => {
    const name = draftName.trim();
    const path = draftPath.trim();
    if (!name || !path) return;

    const nextItems = [...items, { id: `tmp-${Date.now()}`, name, path }];
    setItems(nextItems);
    resetDraft();
    try {
      await updateProject(projectId, {
        repos: [...toPayload(items), { name, path }],
      });
      setFeedback("Folder added");
    } catch {
      setItems(items);
      setFeedback("Failed to add folder");
    }
  };

  const handleSaveEdit = async (repoId: string) => {
    const name = draftName.trim();
    const path = draftPath.trim();
    if (!name || !path) return;

    const previousItems = items;
    const nextItems = items.map((repo) => (repo.id === repoId ? { ...repo, name, path } : repo));
    setItems(nextItems);
    resetDraft();
    try {
      await updateProject(projectId, {
        repos: toPayload(nextItems),
      });
      setFeedback("Folder updated");
    } catch {
      setItems(previousItems);
      setFeedback("Failed to update folder");
    }
  };

  const handleDelete = async (repoId: string) => {
    const previousItems = items;
    const nextItems = items.filter((repo) => repo.id !== repoId);
    setItems(nextItems);
    if (editingId === repoId) {
      resetDraft();
    }
    try {
      await updateProject(projectId, {
        repos: toPayload(nextItems),
      });
      setFeedback("Folder deleted");
    } catch {
      setItems(previousItems);
      setFeedback("Failed to delete folder");
    }
  };

  return (
    <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FolderGit2 className="h-4 w-4 text-[var(--muted-foreground)]" />
          <span className="text-sm font-medium text-[var(--foreground)]">Folders</span>
          {items.length > 0 && (
            <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
              {items.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={startAdd}
            className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
          {onViewAll && (
            <button onClick={onViewAll} className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]">
              View all <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {status && <p className="mb-3 text-xs text-[var(--muted-foreground)]">{status}</p>}

      {(isAdding || editingId) && (
        <div className="mb-3 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3">
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            className="input w-full text-sm"
            placeholder="Folder name"
            autoFocus
          />
          <input
            value={draftPath}
            onChange={(e) => setDraftPath(e.target.value)}
            className="input w-full text-sm"
            placeholder="Local path"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (editingId) {
                  void handleSaveEdit(editingId);
                } else {
                  void handleSaveNew();
                }
              }}
              disabled={!draftName.trim() || !draftPath.trim()}
              className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-xs font-medium text-[var(--background)] disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              onClick={resetDraft}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No folders linked</p>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 5).map((repo) => (
            <div key={repo.id} className="flex items-center gap-2 text-sm">
              <FolderGit2 className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[var(--foreground)]">{repo.name}</div>
                {repo.path && (
                  <div className="truncate text-xs text-[var(--muted-foreground)]">{repo.path}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => startEdit(repo)}
                className="p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                aria-label={`Edit ${repo.name}`}
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(repo.id)}
                className="p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
                aria-label={`Delete ${repo.name}`}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
