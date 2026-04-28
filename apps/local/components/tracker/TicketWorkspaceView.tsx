"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { GitWorkspace } from "@/lib/git-workspaces";
import type {
  GithubPr,
  GithubPrFile,
  GithubPrComment,
} from "@/lib/github-types";
import { ReviewLayout } from "@/components/prs/review/ReviewLayout";
import { WorkspacePicker } from "./WorkspacePicker";

interface Props {
  ticketId: string;
  rightPane: React.ReactNode;
  fallback?: React.ReactNode;
}

interface GitFileChange {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch: string | null;
}

interface GitDiffResult {
  files: GitFileChange[];
  base: string;
  ref: string;
  headSha: string;
}

interface WorkspacesPayload {
  workspaces: GitWorkspace[];
  stale: boolean;
  scannedAt: number | null;
  scanning?: boolean;
}

function basename(p: string): string {
  if (!p) return p;
  const cleaned = p.replace(/\/+$/, "");
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

function mapStatus(s: GitFileChange["status"]): string {
  return s;
}

function emptyPr(): GithubPr {
  return {
    id: "",
    repoId: "",
    number: 0,
    title: "",
    body: "",
    state: "open",
    draft: false,
    authorLogin: "",
    headRef: "",
    headSha: "",
    baseRef: "",
    url: "",
    ciStatus: null,
    reviewDecision: null,
    assignees: [],
    reviewers: [],
    labels: [],
    createdAt: 0,
    updatedAt: 0,
    mergedAt: null,
    closedAt: null,
    lastSyncedAt: 0,
  };
}

export function TicketWorkspaceView({ ticketId, rightPane, fallback }: Props) {
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<GitWorkspace[]>([]);
  const [stale, setStale] = useState(false);
  const [_scannedAt, setScannedAt] = useState<number | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [scanning, setScanning] = useState(false);

  const [selected, setSelected] = useState<{
    repoPath: string;
    ref: string;
  } | null>(null);
  const [diff, setDiff] = useState<GitDiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/git/workspaces?ticketId=${encodeURIComponent(ticketId)}`,
      );
      if (!res.ok) {
        setWorkspaces([]);
        setStale(false);
        setScannedAt(null);
        return;
      }
      const payload = (await res.json()) as WorkspacesPayload;
      setWorkspaces(payload.workspaces ?? []);
      setStale(Boolean(payload.stale));
      setScannedAt(payload.scannedAt ?? null);
      setScanning(Boolean(payload.scanning));
    } catch (err) {
      console.warn("Failed to load workspaces", err);
      setWorkspaces([]);
      setStale(false);
      setScannedAt(null);
      setScanning(false);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    setSelected(null);
    setDiff(null);
    void loadWorkspaces();
  }, [loadWorkspaces]);

  // Poll while a background scan is running
  useEffect(() => {
    if (!scanning) return;
    if (workspaces.length > 0) return;
    const id = setInterval(() => {
      void loadWorkspaces();
    }, 3000);
    return () => clearInterval(id);
  }, [scanning, workspaces.length, loadWorkspaces]);

  // Pick a default selection once workspaces load
  useEffect(() => {
    if (selected || workspaces.length === 0) return;
    const firstWorktree = workspaces.find((w) => w.kind === "worktree");
    const pick = firstWorktree ?? workspaces[0];
    setSelected({ repoPath: pick.repoPath, ref: pick.branch });
  }, [workspaces, selected]);

  // Fetch diff on selection change
  useEffect(() => {
    if (!selected) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    const params = new URLSearchParams({
      repoPath: selected.repoPath,
      ref: selected.ref,
      base: "",
    });
    fetch(`/api/git/diff?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setDiff(null);
          return;
        }
        const payload = (await res.json()) as GitDiffResult;
        if (!cancelled) setDiff(payload);
      })
      .catch((err) => {
        console.warn("Failed to load diff", err);
        if (!cancelled) setDiff(null);
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const handleRescan = useCallback(async () => {
    setRescanning(true);
    try {
      await fetch("/api/git/workspaces/rescan", { method: "POST" });
      await loadWorkspaces();
    } catch (err) {
      console.warn("Rescan failed", err);
    } finally {
      setRescanning(false);
    }
  }, [loadWorkspaces]);

  const handleRefresh = useCallback(async () => {
    if (!selected) return;
    try {
      await fetch("/api/git/workspaces/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath: selected.repoPath, ticketId }),
      });
      await loadWorkspaces();
      // refresh diff
      const params = new URLSearchParams({
        repoPath: selected.repoPath,
        ref: selected.ref,
        base: "",
      });
      const res = await fetch(`/api/git/diff?${params.toString()}`);
      if (res.ok) {
        const payload = (await res.json()) as GitDiffResult;
        setDiff(payload);
      }
    } catch (err) {
      console.warn("Refresh failed", err);
    }
  }, [selected, ticketId, loadWorkspaces]);

  const totals = useMemo(() => {
    if (!diff) return { a: 0, d: 0 };
    return diff.files.reduce(
      (acc, f) => ({ a: acc.a + f.additions, d: acc.d + f.deletions }),
      { a: 0, d: 0 },
    );
  }, [diff]);

  const prFiles: GithubPrFile[] = useMemo(() => {
    if (!diff) return [];
    return diff.files.map((f) => ({
      prId: "",
      path: f.path,
      status: mapStatus(f.status),
      additions: f.additions,
      deletions: f.deletions,
      changes: f.additions + f.deletions,
      patch: f.patch,
      lastSyncedAt: Date.now(),
    }));
  }, [diff]);

  const comments: GithubPrComment[] = useMemo(() => [], []);
  const syntheticPr = useMemo<GithubPr>(() => emptyPr(), []);

  // Loading first time
  if (loading && workspaces.length === 0 && !stale) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted-foreground)",
          fontSize: 12,
        }}
      >
        Loading workspaces...
      </div>
    );
  }

  // Stale and empty
  if (stale && workspaces.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 420,
            border: "1px solid var(--card-border)",
            borderRadius: 8,
            background: "var(--card-bg)",
            padding: 20,
            textAlign: "center",
            color: "var(--foreground)",
          }}
        >
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            Workspace index not yet built (or older than 24h).
          </div>
          {scanning ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid var(--card-border)",
                background: "var(--background)",
                color: "var(--muted-foreground)",
                fontSize: 12,
              }}
            >
              <RefreshCw size={12} className="animate-spin" />
              Indexing...
            </div>
          ) : (
            <button
              type="button"
              onClick={handleRescan}
              disabled={rescanning}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid var(--card-border)",
                background: "var(--background)",
                color: "var(--foreground)",
                fontSize: 12,
                cursor: rescanning ? "default" : "pointer",
              }}
            >
              <RefreshCw
                size={12}
                className={rescanning ? "animate-spin" : undefined}
              />
              Rescan ~
            </button>
          )}
        </div>
      </div>
    );
  }

  // Not stale, no matches => fallback
  if (!stale && workspaces.length === 0) {
    return <>{fallback ?? null}</>;
  }

  const selectedWs = selected
    ? workspaces.find(
        (w) => w.repoPath === selected.repoPath && w.branch === selected.ref,
      )
    : null;
  const repoBasename = selected ? basename(selected.repoPath) : "";
  const branchLabel =
    selected?.ref === "WORKING_TREE"
      ? "working tree"
      : (selectedWs?.branch ?? selected?.ref ?? "");
  const baseLabel = diff?.base ?? "";

  const header = (
    <header
      style={{
        height: 44,
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 14px",
        borderBottom: "1px solid var(--card-border)",
        background: "var(--column-header-bg, var(--card-bg))",
        fontFamily:
          "var(--font-jetbrains-mono), ui-monospace, Menlo, monospace",
        fontSize: 11,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-inter-tight), ui-sans-serif, system-ui",
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: "-0.02em",
          color: "var(--foreground)",
        }}
      >
        {ticketId}
      </span>
      <div
        style={{
          width: 1,
          height: 20,
          background: "var(--card-border)",
        }}
      />
      <WorkspacePicker
        workspaces={workspaces}
        selected={selected}
        onSelect={(sel) => setSelected(sel)}
        onRescan={handleRescan}
        rescanning={rescanning}
      />
      <div style={{ marginLeft: "auto" }}>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={!selected || diffLoading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 26,
            padding: "0 10px",
            borderRadius: 4,
            border: "1px solid var(--card-border)",
            background: "transparent",
            color: "var(--muted-foreground)",
            fontFamily:
              "var(--font-jetbrains-mono), ui-monospace, Menlo, monospace",
            fontSize: 11,
            cursor: !selected || diffLoading ? "default" : "pointer",
          }}
          title="Refresh diff and workspaces"
        >
          <RefreshCw
            size={11}
            className={diffLoading ? "animate-spin" : undefined}
          />
          Refresh
        </button>
      </div>
    </header>
  );

  const statusBar = (
    <footer
      style={{
        height: 26,
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        padding: "0 14px",
        gap: 14,
        borderTop: "1px solid var(--card-border)",
        background: "var(--column-header-bg, var(--card-bg))",
        fontFamily:
          "var(--font-jetbrains-mono), ui-monospace, Menlo, monospace",
        fontSize: 10,
        color: "var(--muted-foreground)",
      }}
    >
      <span>{repoBasename || "—"}</span>
      <span style={{ color: "var(--card-border)" }}>·</span>
      <span style={{ color: "var(--foreground)" }}>{branchLabel || "—"}</span>
      {baseLabel ? (
        <>
          <span style={{ color: "var(--card-border)" }}>·</span>
          <span>base {baseLabel}</span>
        </>
      ) : null}
      <span style={{ color: "var(--card-border)" }}>·</span>
      <span>
        +{totals.a} −{totals.d}
      </span>
      <span style={{ marginLeft: "auto" }}>
        {prFiles.length} file{prFiles.length === 1 ? "" : "s"}
      </span>
    </footer>
  );

  return (
    <ReviewLayout
      pr={syntheticPr}
      files={prFiles}
      comments={comments}
      rightPane={rightPane}
      header={header}
      statusBar={statusBar}
    />
  );
}
