"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import type { GithubPr, GithubRepo } from "@/lib/github-types";

type QuickFilter = "all" | "mine" | "awaiting_review";

interface ApiResponse {
  prs: GithubPr[];
  repos: GithubRepo[];
}

const DEV_MODE = process.env.NODE_ENV !== "production";
// Hardcoded default for the skeleton — real auth will supply this later.
const DEFAULT_AUTHOR_LOGIN = "mendrika";

function statePillClasses(pr: GithubPr): string {
  if (pr.state === "merged")
    return "bg-purple-500/15 text-purple-400 border-purple-500/30";
  if (pr.state === "closed")
    return "bg-red-500/15 text-red-400 border-red-500/30";
  if (pr.draft)
    return "bg-neutral-500/15 text-neutral-400 border-neutral-500/30";
  return "bg-green-500/15 text-green-400 border-green-500/30";
}

function stateLabel(pr: GithubPr): string {
  if (pr.state === "merged") return "Merged";
  if (pr.state === "closed") return "Closed";
  if (pr.draft) return "Draft";
  return "Open";
}

function ciIcon(status: GithubPr["ciStatus"]): { symbol: string; color: string } {
  if (status === "success") return { symbol: "✓", color: "text-green-500" };
  if (status === "failure") return { symbol: "✗", color: "text-red-500" };
  if (status === "pending") return { symbol: "●", color: "text-amber-500" };
  return { symbol: "—", color: "text-neutral-500" };
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export default function ProjectPrsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  void slug;

  const [prs, setPrs] = useState<GithubPr[]>([]);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [repoId, setRepoId] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState<boolean>(false);

  const fetchPrs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("quickFilter", quickFilter);
      qs.set("authorLogin", DEFAULT_AUTHOR_LOGIN);
      if (repoId) qs.set("repoId", repoId);
      const res = await fetch(`/api/github/prs?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ApiResponse;
      setPrs(data.prs);
      setRepos(data.repos);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [quickFilter, repoId]);

  useEffect(() => {
    void fetchPrs();
  }, [fetchPrs]);

  const handleSeed = useCallback(async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/github/prs/seed", { method: "POST" });
      if (!res.ok) throw new Error(`Seed failed: HTTP ${res.status}`);
      await fetchPrs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(false);
    }
  }, [fetchPrs]);

  const selectedPr = useMemo(
    () => prs.find((p) => p.id === selectedId) ?? null,
    [prs, selectedId],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--app-shell-pane,#0f1115)] text-neutral-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h1 className="text-lg font-semibold">Pull Requests</h1>
        {DEV_MODE && (
          <button
            type="button"
            onClick={handleSeed}
            disabled={seeding}
            className="rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
          >
            {seeding ? "Seeding…" : "Seed demo data"}
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-1">
          {(
            [
              ["all", "All"],
              ["mine", "My PRs"],
              ["awaiting_review", "Awaiting my review"],
            ] as [QuickFilter, string][]
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setQuickFilter(val)}
              className={`rounded px-2.5 py-1 text-xs ${
                quickFilter === val
                  ? "bg-neutral-700 text-white"
                  : "text-neutral-400 hover:bg-neutral-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <select
            value={repoId}
            onChange={(e) => setRepoId(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
          >
            <option value="">All repos</option>
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Body: list + detail */}
      <div className="flex min-h-0 flex-1">
        {/* List */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {loading && prs.length === 0 && (
            <div className="px-4 py-6 text-sm text-neutral-500">Loading…</div>
          )}
          {error && (
            <div className="px-4 py-6 text-sm text-red-400">Error: {error}</div>
          )}
          {!loading && !error && prs.length === 0 && (
            <div className="px-4 py-6 text-sm text-neutral-500">
              No pull requests.{" "}
              {DEV_MODE && "Click \u201cSeed demo data\u201d to populate."}
            </div>
          )}
          {prs.map((pr) => {
            const repo = repos.find((r) => r.id === pr.repoId);
            const ci = ciIcon(pr.ciStatus);
            const isSelected = pr.id === selectedId;
            return (
              <button
                type="button"
                key={pr.id}
                onClick={() => setSelectedId(pr.id)}
                className={`flex flex-col gap-0.5 border-b border-neutral-800/60 px-4 py-2 text-left text-sm hover:bg-neutral-800/50 ${
                  isSelected ? "bg-neutral-800/70" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-xs text-neutral-500">
                    {repo ? `${repo.owner}/${repo.name}` : pr.repoId}#{pr.number}
                  </span>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${statePillClasses(pr)}`}
                  >
                    {stateLabel(pr)}
                  </span>
                  <span className={`text-xs ${ci.color}`} title={`CI: ${pr.ciStatus ?? "none"}`}>
                    {ci.symbol}
                  </span>
                </div>
                <div className="truncate text-neutral-100">{pr.title}</div>
                <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                  <span>@{pr.authorLogin}</span>
                  <span>·</span>
                  <span>{formatRelative(pr.updatedAt)}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Detail panel */}
        <div className="hidden w-[380px] shrink-0 flex-col border-l border-neutral-800 md:flex">
          {selectedPr ? (
            <div className="flex flex-col gap-3 overflow-y-auto p-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-neutral-500">
                  {selectedPr.repoId}#{selectedPr.number}
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${statePillClasses(selectedPr)}`}
                >
                  {stateLabel(selectedPr)}
                </span>
                <span
                  className={`text-xs ${ciIcon(selectedPr.ciStatus).color}`}
                >
                  {ciIcon(selectedPr.ciStatus).symbol}
                </span>
              </div>
              <div className="text-base font-semibold text-neutral-100">
                {selectedPr.title}
              </div>
              <div className="whitespace-pre-wrap text-xs text-neutral-400">
                {selectedPr.body.length > 500
                  ? selectedPr.body.slice(0, 500) + "…"
                  : selectedPr.body || "(no description)"}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-neutral-500">
                  Reviewers
                </div>
                {selectedPr.reviewers.length === 0 ? (
                  <div className="text-xs text-neutral-500">None</div>
                ) : (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {selectedPr.reviewers.map((r) => (
                      <li
                        key={r.login}
                        className="flex items-center justify-between text-xs"
                      >
                        <span>@{r.login}</span>
                        <span className="text-neutral-500">{r.state}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <a
                href={selectedPr.url}
                target="_blank"
                rel="noreferrer"
                className="inline-block rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs hover:bg-neutral-700"
              >
                Open on GitHub ↗
              </a>
              <div className="mt-auto rounded border border-dashed border-neutral-700 p-3 text-xs text-neutral-500">
                Composer coming soon
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-xs text-neutral-500">
              Select a PR to see details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
