"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  MessageSquare,
  Plus,
  Search,
  Hash,
} from "lucide-react";
import type { Thread, ThreadStatus } from "@/lib/storage";

type TabKey = "all" | "active" | "paused" | "done" | "archived";

const TABS: { key: TabKey; label: string; statuses: Set<ThreadStatus | undefined> }[] = [
  { key: "all", label: "All", statuses: new Set() },
  { key: "active", label: "Active", statuses: new Set(["active", undefined]) },
  { key: "paused", label: "Paused", statuses: new Set(["paused", "in-review"]) },
  { key: "done", label: "Done", statuses: new Set(["done"]) },
  { key: "archived", label: "Archived", statuses: new Set(["archived"]) },
];

const STATUS_COLORS: Record<string, string> = {
  active: "#f59e0b",
  paused: "#f97316",
  "in-review": "#6b7280",
  done: "#3b82f6",
  archived: "#9ca3af",
};

function statusColor(status: ThreadStatus | undefined): string {
  return STATUS_COLORS[status ?? "active"] ?? STATUS_COLORS.active;
}

const formatTimestamp = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);

function getPreview(thread: Thread): string {
  const latest = thread.messages.at(-1)?.content?.trim();
  if (!latest) return "No messages yet";
  const normalized = latest.replace(/\s+/g, " ");
  return normalized.length > 120 ? `${normalized.slice(0, 120).trim()}…` : normalized;
}

interface ThreadsListViewProps {
  projectSlug: string;
  threads: Thread[];
  onCreateThread?: () => void;
}

export function ThreadsListView({ projectSlug, threads, onCreateThread }: ThreadsListViewProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");

  const sorted = useMemo(
    () => [...threads].sort((a, b) => b.updatedAt - a.updatedAt),
    [threads],
  );

  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { all: 0, active: 0, paused: 0, done: 0, archived: 0 };
    for (const t of sorted) {
      counts.all++;
      const s = t.status ?? "active";
      if (s === "active") counts.active++;
      else if (s === "paused" || s === "in-review") counts.paused++;
      else if (s === "done") counts.done++;
      else if (s === "archived") counts.archived++;
    }
    return counts;
  }, [sorted]);

  const filtered = useMemo(() => {
    const tab = TABS.find((t) => t.key === activeTab)!;
    let list = sorted;
    if (tab.statuses.size > 0) {
      list = list.filter((t) => tab.statuses.has(t.status ?? undefined));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          (t.title ?? "").toLowerCase().includes(q) ||
          getPreview(t).toLowerCase().includes(q),
      );
    }
    return list;
  }, [sorted, activeTab, search]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-[var(--app-shell-border)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10">
              <MessageSquare size={16} className="text-indigo-500" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-[var(--foreground)]">Threads</h1>
              <p className="text-xs text-[var(--muted-foreground)]">
                {threads.length} thread{threads.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          {onCreateThread && (
            <button
              type="button"
              onClick={onCreateThread}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
            >
              <Plus size={14} />
              New Thread
            </button>
          )}
        </div>

        {/* Summary bar */}
        <div className="flex items-center gap-4 mb-4">
          {(["active", "paused", "done", "archived"] as const).map((key) =>
            tabCounts[key] > 0 ? (
              <div key={key} className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                <span
                  className={`h-2 w-2 rounded-full${key === "active" ? " animate-pulse" : ""}`}
                  style={{ backgroundColor: STATUS_COLORS[key === "paused" ? "paused" : key] }}
                />
                {tabCounts[key]} {key}
              </div>
            ) : null,
          )}
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-[var(--app-shell-border)] bg-[var(--app-shell-subtle)] px-2.5 py-1.5 flex-1 max-w-xs">
            <Search size={13} className="text-[var(--muted-foreground)] flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search threads…"
              className="flex-1 bg-transparent text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none"
            />
          </div>
          <div className="flex items-center gap-0.5">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  activeTab === tab.key
                    ? "bg-[var(--app-shell-elevated)] text-[var(--foreground)] shadow-sm"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--app-shell-subtle)]"
                }`}
              >
                {tab.label}
                {tabCounts[tab.key] > 0 && (
                  <span className="ml-1 text-[10px] opacity-60">{tabCounts[tab.key]}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Thread rows */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MessageSquare size={32} className="text-[var(--muted-foreground)] mb-3 opacity-40" />
            <p className="text-sm font-medium text-[var(--foreground)] mb-1">
              {search ? "No threads match your search" : "No threads yet"}
            </p>
            <p className="text-xs text-[var(--muted-foreground)] mb-4 max-w-xs">
              {search
                ? "Try a different search term."
                : "Start a conversation to get things moving."}
            </p>
            {!search && onCreateThread && (
              <button
                type="button"
                onClick={onCreateThread}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
              >
                <Plus size={14} />
                New Thread
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--app-shell-border)]" role="list">
            {filtered.map((thread) => {
              const title = thread.title?.trim() || "Untitled thread";
              const preview = getPreview(thread);
              const status = thread.status ?? "active";
              const msgCount = thread.messages.length;

              return (
                <li key={thread.id}>
                  <Link
                    href={`/projects/${projectSlug}/thread/${encodeURIComponent(thread.id)}`}
                    className="flex items-start gap-3 px-6 py-3.5 transition-colors hover:bg-[var(--app-shell-subtle)] group"
                  >
                    {/* Status dot */}
                    <span
                      className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0${status === "active" ? " animate-pulse" : ""}`}
                      style={{ backgroundColor: statusColor(thread.status) }}
                    />
                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Hash size={12} className="text-[var(--muted-foreground)] flex-shrink-0" />
                        <span className="text-sm font-medium text-[var(--foreground)] truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                          {title}
                        </span>
                        {status !== "active" && (
                          <span
                            className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                            style={{
                              backgroundColor: `${statusColor(thread.status)}15`,
                              color: statusColor(thread.status),
                            }}
                          >
                            {status}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--muted-foreground)] truncate">{preview}</p>
                    </div>
                    {/* Meta */}
                    <div className="flex flex-col items-end gap-1 flex-shrink-0 text-right">
                      <span className="text-[11px] text-[var(--muted-foreground)]">
                        {formatTimestamp(thread.updatedAt)}
                      </span>
                      {msgCount > 0 && (
                        <span className="text-[10px] text-[var(--muted-foreground)] opacity-70">
                          {msgCount} msg{msgCount !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
