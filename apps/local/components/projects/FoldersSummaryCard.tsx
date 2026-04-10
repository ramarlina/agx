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
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FolderGit2 className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">Folders</span>
          {items.length > 0 && (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {items.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={startAdd}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
          {onViewAll && (
            <button onClick={onViewAll} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
              View all <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {status && <p className="mb-3 text-xs text-zinc-500">{status}</p>}

      {(isAdding || editingId) && (
        <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 space-y-2">
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
              className="rounded-lg bg-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-950 disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              onClick={resetDraft}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">No folders linked</p>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 5).map((repo) => (
            <div key={repo.id} className="flex items-center gap-2 text-sm">
              <FolderGit2 className="w-4 h-4 text-zinc-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-zinc-300 truncate">{repo.name}</div>
                {repo.path && (
                  <div className="text-zinc-500 text-xs truncate">{repo.path}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => startEdit(repo)}
                className="p-1 text-zinc-500 hover:text-zinc-300"
                aria-label={`Edit ${repo.name}`}
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(repo.id)}
                className="p-1 text-zinc-500 hover:text-red-400"
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
