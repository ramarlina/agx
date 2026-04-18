"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import type { GithubPr, TrackerTargetType } from "@/lib/github-types";

interface Props {
  targetType: TrackerTargetType;
  targetId: string;
  projectSlug: string;
}

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

function ciIcon(status: GithubPr["ciStatus"]): { symbol: string; color: string } | null {
  if (status === "success") return { symbol: "✓", color: "text-green-500" };
  if (status === "failure") return { symbol: "✗", color: "text-red-500" };
  if (status === "pending") return { symbol: "●", color: "text-amber-500" };
  return null;
}

function reviewDecisionChip(decision: GithubPr["reviewDecision"]): { label: string; cls: string } | null {
  if (decision === "approved")
    return { label: "approved", cls: "bg-green-500/15 text-green-400 border-green-500/30" };
  if (decision === "changes_requested")
    return { label: "changes requested", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
  if (decision === "review_required")
    return { label: "review required", cls: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30" };
  return null;
}

export function LinkedPrsSection({ targetType, targetId, projectSlug }: Props) {
  const [prs, setPrs] = useState<GithubPr[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchPrs = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ targetType, targetId });
      const res = await fetch(`/api/github/prs/for-target?${qs.toString()}`);
      if (!res.ok) {
        setPrs([]);
      } else {
        const data = (await res.json()) as { prs: GithubPr[] };
        setPrs(data.prs);
      }
    } catch {
      setPrs([]);
    } finally {
      setLoaded(true);
    }
  }, [targetType, targetId]);

  useEffect(() => {
    setLoaded(false);
    setFormOpen(false);
    setUrl("");
    setFormError(null);
    void fetchPrs();
  }, [fetchPrs]);

  const handleRowClick = useCallback(
    (pr: GithubPr) => {
      const href = `/projects/${encodeURIComponent(projectSlug)}/prs?pr=${encodeURIComponent(pr.id)}`;
      window.location.href = href;
    },
    [projectSlug],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!url.trim() || submitting) return;
      setSubmitting(true);
      setFormError(null);
      try {
        const res = await fetch("/api/github/prs/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim(), targetType, targetId }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        if (!res.ok) {
          setFormError(payload.message || payload.error || `HTTP ${res.status}`);
          return;
        }
        setUrl("");
        setFormOpen(false);
        await fetchPrs();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [url, submitting, targetType, targetId, fetchPrs],
  );

  const handleDelete = useCallback(
    async (pr: GithubPr, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!window.confirm(`Unlink ${pr.id} from this issue?`)) return;
      try {
        const res = await fetch("/api/github/prs/link", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prId: pr.id, targetType, targetId }),
        });
        if (!res.ok) return;
        await fetchPrs();
      } catch {
        /* noop */
      }
    },
    [targetType, targetId, fetchPrs],
  );

  if (!loaded) return null;
  if (prs.length === 0 && !formOpen) return null;

  return (
    <section className="border-b border-[var(--card-border)] px-6 py-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Pull Requests ({prs.length})
        </h3>
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="flex items-center gap-1 rounded-md border border-[var(--card-border)] px-2 py-1 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
        >
          <Plus size={12} />
          Link PR
        </button>
      </div>

      {formOpen && (
        <form onSubmit={handleSubmit} className="mb-3 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo/pull/123"
              className="flex-1 rounded border border-[var(--card-border)] bg-transparent px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-blue-500"
              autoFocus
            />
            <button
              type="submit"
              disabled={submitting || !url.trim()}
              className="rounded-md bg-blue-500 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
            >
              {submitting ? "Linking…" : "Link"}
            </button>
            <button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setFormError(null);
                setUrl("");
              }}
              className="rounded-md border border-[var(--card-border)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Cancel
            </button>
          </div>
          {formError && (
            <div className="text-xs text-red-400">{formError}</div>
          )}
        </form>
      )}

      <ul className="flex flex-col gap-1">
        {prs.map((pr) => {
          const ci = ciIcon(pr.ciStatus);
          const review = reviewDecisionChip(pr.reviewDecision);
          return (
            <li key={pr.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => handleRowClick(pr)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleRowClick(pr);
                  }
                }}
                className="group flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm hover:border-[var(--card-border)] hover:bg-[var(--card-bg)]"
              >
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${statePillClasses(pr)}`}
                >
                  {stateLabel(pr)}
                </span>
                <span className="shrink-0 font-mono text-xs text-[var(--muted-foreground)]">
                  {pr.id}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">
                  {pr.title}
                </span>
                {ci && (
                  <span className={`shrink-0 text-xs ${ci.color}`} title={`CI: ${pr.ciStatus}`}>
                    {ci.symbol}
                  </span>
                )}
                {review && (
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${review.cls}`}
                  >
                    {review.label}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => handleDelete(pr, e)}
                  className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                  title="Unlink"
                  aria-label="Unlink PR"
                >
                  <X size={12} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
