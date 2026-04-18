"use client";

import { use, useCallback, useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { useProjectsWithAgents } from "@/hooks/useProjects";

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

interface OAuthStatus {
  connected: boolean;
  login: string | null;
  scopes: string[];
  expiresAt: number | null;
}

export default function GithubSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { projects } = useProjectsWithAgents();
  const project = projects.find((p) => p.slug === slug);

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-zinc-500">
        Loading...
      </div>
    );
  }

  return <GithubSettingsView projectId={project.id} projectName={project.name} />;
}

function GithubSettingsView({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [reposError, setReposError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [newOwner, setNewOwner] = useState("");
  const [newName, setNewName] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/github/oauth/status?projectId=${encodeURIComponent(projectId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load status");
      const data = (await res.json()) as OAuthStatus;
      setStatus(data);
      setStatusError(null);
    } catch {
      setStatusError("Failed to load GitHub connection status");
    } finally {
      setStatusLoading(false);
    }
  }, [projectId]);

  const fetchRepos = useCallback(async () => {
    try {
      const res = await fetch("/api/github/repos", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load repos");
      const data = (await res.json()) as { repos: GithubRepo[] };
      setRepos(data.repos ?? []);
      setReposError(null);
    } catch {
      setReposError("Failed to load repositories");
    } finally {
      setReposLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    void fetchRepos();
  }, [fetchStatus, fetchRepos]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const res = await fetch(
        `/api/github/oauth/start?projectId=${encodeURIComponent(projectId)}`,
      );
      if (!res.ok) throw new Error("Failed to start OAuth");
      const data = (await res.json()) as { url: string };
      window.open(data.url, "_blank", "noopener,noreferrer,width=600,height=700");
    } catch {
      setStatusError("Could not start GitHub sign-in");
    } finally {
      setConnecting(false);
    }
  }, [projectId]);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await fetch("/api/github/oauth/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      await fetchStatus();
    } finally {
      setDisconnecting(false);
    }
  }, [projectId, fetchStatus]);

  const handleAdd = useCallback(async () => {
    const owner = newOwner.trim();
    const name = newName.trim();
    if (!owner || !name) {
      setAddError("Owner and name are required");
      return;
    }
    setAddSaving(true);
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
      setAddSaving(false);
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
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <header>
        <h1 className="text-xl font-semibold">GitHub</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Connect {projectName} to GitHub to sync pull requests and review comments.
        </p>
      </header>

      <section className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium">Account</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              The GitHub identity we use for API calls on this project.
            </p>
          </div>
        </div>

        {statusLoading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking connection...
          </div>
        ) : statusError ? (
          <p className="text-sm text-red-500">{statusError}</p>
        ) : status?.connected ? (
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              Connected as{" "}
              <span className="font-mono font-medium">@{status.login}</span>
              {status.scopes.length > 0 && (
                <span className="text-xs text-zinc-500 ml-2">
                  ({status.scopes.join(", ")})
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="text-xs px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting..." : "Disconnect"}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">Not connected to GitHub.</p>
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting}
              className="text-xs px-3 py-1.5 rounded bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-50"
            >
              {connecting ? "Opening..." : "Connect GitHub"}
            </button>
          </div>
        )}
      </section>

      <section className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium">Attached repositories</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Repos the local agent watches for PRs, reviews, and comments.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="text-xs px-2.5 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Add repo
          </button>
        </div>

        {showAdd && (
          <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="owner"
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
                className="flex-1 px-2 py-1.5 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-transparent"
              />
              <span className="text-zinc-400 self-center">/</span>
              <input
                type="text"
                placeholder="name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="flex-1 px-2 py-1.5 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-transparent"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={addSaving}
                className="text-xs px-3 py-1.5 rounded bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-50"
              >
                {addSaving ? "Adding..." : "Add"}
              </button>
            </div>
            {addError && <p className="text-xs text-red-500">{addError}</p>}
          </div>
        )}

        {reposLoading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading repositories...
          </div>
        ) : reposError ? (
          <p className="text-sm text-red-500">{reposError}</p>
        ) : repos.length === 0 ? (
          <p className="text-sm text-zinc-500">No repositories attached yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {repos.map((repo) => (
              <li
                key={repo.id}
                className="flex items-center justify-between py-2"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-mono">
                    {repo.owner}/{repo.name}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {repo.defaultBranch ?? "no default branch"}
                    {repo.private ? " · private" : " · public"}
                    {repo.accessRevoked ? " · access revoked" : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(repo.id)}
                  disabled={removingId === repo.id}
                  className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                  title="Remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 space-y-3">
        <div>
          <h2 className="text-sm font-medium">Sync</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Pull the latest PRs, reviews, and comments for attached repos.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            alert("Sync will run when OAuth is fully wired.")
          }
          className="text-xs px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Sync now
        </button>
      </section>
    </div>
  );
}
