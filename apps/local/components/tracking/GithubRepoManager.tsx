"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, X, RefreshCw } from "lucide-react";

interface GithubRepo {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string | null;
  private: boolean;
  accessRevoked: boolean;
  addedAt: number;
  lastSyncedAt: number | null;
}

/**
 * Post-connect pane shown after a user connects GitHub from the tracker
 * picker. Lets them attach/detach repos and trigger a sync.
 */
export default function GithubRepoManager() {
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [newOwner, setNewOwner] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchRepos = useCallback(async () => {
    try {
      const res = await fetch("/api/github/repos", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load repos");
      const data = (await res.json()) as { repos: GithubRepo[] };
      setRepos(data.repos ?? []);
      setError(null);
    } catch {
      setError("Failed to load repositories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRepos();
  }, [fetchRepos]);

  const handleAdd = useCallback(async () => {
    const owner = newOwner.trim();
    const name = newName.trim();
    if (!owner || !name) {
      setAddError("Owner and name are required");
      return;
    }
    setSaving(true);
    setAddError(null);
    try {
      const res = await fetch("/api/github/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner, name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to add repo");
      }
      setNewOwner("");
      setNewName("");
      setShowAdd(false);
      await fetchRepos();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add repo");
    } finally {
      setSaving(false);
    }
  }, [newOwner, newName, fetchRepos]);

  const handleRemove = useCallback(
    async (id: string) => {
      setRemovingId(id);
      try {
        await fetch("/api/github/repos", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        });
        await fetchRepos();
      } finally {
        setRemovingId(null);
      }
    },
    [fetchRepos],
  );

  return (
    <div className="w-full max-w-md space-y-4">
      <div className="border rounded-xl p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="text-sm font-medium">Attached repositories</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Repos the local agent watches for PRs, reviews, and comments.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="text-xs px-2.5 py-1.5 rounded border hover:bg-accent inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>

        {showAdd && (
          <div className="rounded border p-3 space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="owner"
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
                className="flex-1 px-2 py-1.5 text-sm rounded border bg-transparent"
              />
              <span className="text-muted-foreground self-center">/</span>
              <input
                type="text"
                placeholder="name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="flex-1 px-2 py-1.5 text-sm rounded border bg-transparent"
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={saving}
                className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Adding…" : "Add"}
              </button>
            </div>
            {addError && <p className="text-xs text-destructive">{addError}</p>}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading repositories…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : repos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No repositories attached yet.
          </p>
        ) : (
          <ul className="divide-y">
            {repos.map((repo) => (
              <li
                key={repo.id}
                className="flex items-center justify-between py-2"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-mono">
                    {repo.owner}/{repo.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {repo.defaultBranch ?? "no default branch"}
                    {repo.private ? " · private" : " · public"}
                    {repo.accessRevoked ? " · access revoked" : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(repo.id)}
                  disabled={removingId === repo.id}
                  className="p-1.5 rounded hover:bg-accent disabled:opacity-50"
                  title="Remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border rounded-xl p-5 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium">Sync</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pull the latest PRs, reviews, and comments for attached repos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => alert("Sync will run when worker is scheduled")}
          className="text-xs px-3 py-1.5 rounded border hover:bg-accent inline-flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Sync now
        </button>
      </div>
    </div>
  );
}
