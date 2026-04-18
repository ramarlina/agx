"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, X, RefreshCw, Pin } from "lucide-react";

interface AttachedRepo {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string | null;
  private: boolean;
  accessRevoked: boolean;
  addedAt: number;
  lastSyncedAt: number | null;
}

interface UserRepo {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  avatarUrl: string;
}

interface Props {
  projectId: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export default function GithubRepoManager({ projectId }: Props) {
  const [repos, setRepos] = useState<AttachedRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [userRepos, setUserRepos] = useState<UserRepo[]>([]);
  const [userReposLoading, setUserReposLoading] = useState(false);
  const [userReposError, setUserReposError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "public" | "private">("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  const fetchRepos = useCallback(async () => {
    try {
      const res = await fetch("/api/github/repos", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load repos");
      const data = (await res.json()) as { repos: AttachedRepo[] };
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

  const attachedKey = useCallback((owner: string, name: string) => `${owner}/${name}`.toLowerCase(), []);
  const attachedSet = useMemo(
    () => new Set(repos.map((r) => attachedKey(r.owner, r.name))),
    [repos, attachedKey],
  );

  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    setSelected(new Set());
    setQuery("");
    setFilter("all");
    if (userRepos.length > 0) return;
    setUserReposLoading(true);
    setUserReposError(null);
    try {
      const res = await fetch(`/api/github/user-repos?projectId=${encodeURIComponent(projectId)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to fetch repos");
      }
      const data = (await res.json()) as { repos: UserRepo[] };
      setUserRepos(data.repos ?? []);
    } catch (err) {
      setUserReposError(err instanceof Error ? err.message : "Failed to fetch repos");
    } finally {
      setUserReposLoading(false);
    }
  }, [projectId, userRepos.length]);

  const closePicker = () => {
    setPickerOpen(false);
  };

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePicker();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  const sortedUserRepos = useMemo(() => {
    const attached: UserRepo[] = [];
    const rest: UserRepo[] = [];
    for (const r of userRepos) {
      if (attachedSet.has(attachedKey(r.owner, r.name))) attached.push(r);
      else rest.push(r);
    }
    return [...attached, ...rest];
  }, [userRepos, attachedSet, attachedKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortedUserRepos.filter((r) => {
      if (filter === "public" && r.private) return false;
      if (filter === "private" && !r.private) return false;
      if (!q) return true;
      return (
        r.fullName.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [sortedUserRepos, query, filter]);

  const selectableFiltered = useMemo(
    () => filtered.filter((r) => !attachedSet.has(attachedKey(r.owner, r.name))),
    [filtered, attachedSet, attachedKey],
  );
  const allFilteredSelected =
    selectableFiltered.length > 0 && selectableFiltered.every((r) => selected.has(r.id));

  const toggle = (repo: UserRepo) => {
    if (attachedSet.has(attachedKey(repo.owner, repo.name))) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(repo.id)) next.delete(repo.id);
      else next.add(repo.id);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        selectableFiltered.forEach((r) => next.delete(r.id));
      } else {
        selectableFiltered.forEach((r) => next.add(r.id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const handleAttachSelected = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      const toAdd = userRepos.filter((r) => selected.has(r.id));
      await Promise.all(
        toAdd.map((r) =>
          fetch("/api/github/repos", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              owner: r.owner,
              name: r.name,
              defaultBranch: r.defaultBranch,
              private: r.private,
            }),
          }),
        ),
      );
      await fetchRepos();
      closePicker();
    } finally {
      setSaving(false);
    }
  };

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
            onClick={openPicker}
            className="text-xs px-2.5 py-1.5 rounded border hover:bg-accent inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>

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

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={closePicker}
        >
          <div
            className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-6 py-5 border-b border-[var(--border)] flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] mb-1">
                  <span>GitHub</span>
                  <span>·</span>
                  <span>Attach repositories</span>
                </div>
                <h1 className="text-xl font-semibold tracking-tight">Select repositories</h1>
                <p className="text-sm text-[var(--muted-foreground)] mt-1">
                  Pick the repos you want agx to track. Already-attached repos are pinned at the top.
                </p>
              </div>
              <button
                onClick={closePicker}
                className="p-1.5 rounded hover:bg-[var(--item-hover-bg)] text-[var(--muted-foreground)]"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="px-6 py-4 flex-1 overflow-hidden flex flex-col">
              {userReposError ? (
                <div className="rounded-lg border border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] text-[var(--status-failed)] px-4 py-3 text-sm">
                  {userReposError}
                </div>
              ) : (
                <>
                  <div className="flex flex-col sm:flex-row gap-2 mb-3">
                    <div className="relative flex-1">
                      <svg
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.3-4.3" />
                      </svg>
                      <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search repositories..."
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--input)] text-sm focus:outline-none focus:border-[var(--primary)] focus:bg-[var(--input-focus)] transition-colors"
                      />
                    </div>
                    <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1">
                      {(["all", "public", "private"] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => setFilter(f)}
                          className={`px-3 py-1 text-xs rounded-md capitalize transition-colors ${
                            filter === f
                              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                          }`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between mb-2 text-xs text-[var(--muted-foreground)]">
                    <button
                      onClick={toggleAllFiltered}
                      disabled={selectableFiltered.length === 0}
                      className="hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
                    >
                      {allFilteredSelected ? "Deselect all" : "Select all"}
                      {query || filter !== "all" ? ` (${selectableFiltered.length} shown)` : ""}
                    </button>
                    {selected.size > 0 && (
                      <button
                        onClick={clearSelection}
                        className="hover:text-[var(--foreground)] transition-colors"
                      >
                        Clear selection
                      </button>
                    )}
                  </div>

                  <div className="rounded-lg border border-[var(--border)] bg-[var(--card-bg)] overflow-hidden flex-1 min-h-0">
                    <div className="h-full overflow-y-auto">
                      {userReposLoading ? (
                        <div className="divide-y divide-[var(--border)]">
                          {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="px-4 py-3 flex items-center gap-3 animate-pulse">
                              <div className="w-4 h-4 rounded bg-[var(--muted)]" />
                              <div className="w-6 h-6 rounded-full bg-[var(--muted)]" />
                              <div className="flex-1 space-y-2">
                                <div className="h-3 w-1/3 rounded bg-[var(--muted)]" />
                                <div className="h-2 w-2/3 rounded bg-[var(--muted)]" />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : filtered.length === 0 ? (
                        <div className="px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
                          {userRepos.length === 0
                            ? "No repositories found on your account."
                            : "No repos match your search."}
                        </div>
                      ) : (
                        <ul className="divide-y divide-[var(--border)]">
                          {filtered.map((repo) => {
                            const isAttached = attachedSet.has(attachedKey(repo.owner, repo.name));
                            const isSelected = selected.has(repo.id);
                            return (
                              <li key={repo.id}>
                                <label
                                  className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                                    isAttached
                                      ? "bg-[var(--primary-muted)]/40 cursor-default"
                                      : isSelected
                                      ? "bg-[var(--primary-muted)] cursor-pointer"
                                      : "hover:bg-[var(--item-hover-bg)] cursor-pointer"
                                  }`}
                                >
                                  {isAttached ? (
                                    <div
                                      className="mt-1 w-4 h-4 rounded-sm bg-[var(--primary)]/20 text-[var(--primary)] flex items-center justify-center"
                                      title="Already attached"
                                    >
                                      <Pin className="w-2.5 h-2.5" />
                                    </div>
                                  ) : (
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggle(repo)}
                                      className="mt-1 accent-[var(--primary)]"
                                    />
                                  )}
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={repo.avatarUrl}
                                    alt=""
                                    className="w-6 h-6 rounded-full mt-0.5 flex-shrink-0"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-sm font-medium truncate">{repo.fullName}</span>
                                      {isAttached && (
                                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--primary)]/15 text-[var(--primary)] flex items-center gap-1">
                                          <Pin className="w-2.5 h-2.5" />
                                          Attached
                                        </span>
                                      )}
                                      {repo.private && (
                                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">
                                          Private
                                        </span>
                                      )}
                                    </div>
                                    {repo.description && (
                                      <p className="text-xs text-[var(--muted-foreground)] mt-0.5 line-clamp-1">
                                        {repo.description}
                                      </p>
                                    )}
                                    <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
                                      Updated {relativeTime(repo.updatedAt)}
                                    </div>
                                  </div>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <footer className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between gap-3">
              <span className="text-sm text-[var(--muted-foreground)]">
                {selected.size} selected
              </span>
              <div className="flex gap-2">
                <button
                  onClick={closePicker}
                  className="px-4 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--item-hover-bg)] text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAttachSelected}
                  disabled={selected.size === 0 || saving}
                  className="px-4 py-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[var(--primary-foreground)] text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving
                    ? "Attaching..."
                    : `Attach ${selected.size} ${selected.size === 1 ? "repo" : "repos"}`}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
