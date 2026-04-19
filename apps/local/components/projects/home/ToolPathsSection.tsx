"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, TerminalSquare } from "lucide-react";
import { useTrackerConnection } from "@/hooks/useTrackerConnection";
import { TrackerIcon } from "@/components/tracking/TrackerIcon";
import type { TerminalSession } from "@/lib/terminal-types";
import { useTerminalTabsStore } from "@/state/terminalTabs";
import { ToolPathCard } from "./ToolPathCard";

interface ThreadEntry {
  id: string;
  threadId: string;
  title: string;
  status: string;
}

interface WorkspaceGroup {
  name: string;
  threads: ThreadEntry[];
}

interface ToolPathsSectionProps {
  projectId: string;
  projectSlug: string;
  primaryThreadId: string | null;
}

function formatSavedSessionCount(count: number): string {
  return `${count} saved session${count === 1 ? "" : "s"}`;
}

function getLatestTerminalSession(
  sessions: TerminalSession[],
): TerminalSession | null {
  if (sessions.length === 0) {
    return null;
  }

  return sessions.reduce((latest, session) =>
    session.createdAt > latest.createdAt ? session : latest,
  );
}

export function ToolPathsSection({ projectId, projectSlug, primaryThreadId }: ToolPathsSectionProps) {
  const router = useRouter();
  const { connected, loading: trackerLoading } = useTrackerConnection("linear", projectId);
  const [threads, setThreads] = useState<ThreadEntry[] | null>(null);
  const [threadCount, setThreadCount] = useState(0);
  const projectTerminalSessions = useTerminalTabsStore((state) => state.sessions[projectSlug]);
  const terminalSessions = projectTerminalSessions ?? [];
  const [terminalSessionsHydrated, setTerminalSessionsHydrated] = useState(() =>
    useTerminalTabsStore.persist.hasHydrated(),
  );

  const latestTerminalSession = useMemo(
    () => getLatestTerminalSession(terminalSessions),
    [terminalSessions],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/threads?projectId=${encodeURIComponent(projectId)}&limit=3&format=json`)
      .then((r) => (r.ok ? r.json() : { threads: {}, total: 0 }))
      .then((data) => {
        if (cancelled) return;
        const groups = Object.values((data.threads ?? {}) as Record<string, WorkspaceGroup>);
        const flat = groups
          .flatMap((g) => g.threads ?? [])
          .slice(0, 3);
        setThreads(flat);
        setThreadCount(typeof data.total === "number" ? data.total : flat.length);
      })
      .catch(() => {
        if (!cancelled) { setThreads([]); setThreadCount(0); }
      });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    setTerminalSessionsHydrated(useTerminalTabsStore.persist.hasHydrated());
    const unsubscribe = useTerminalTabsStore.persist.onFinishHydration(() => {
      setTerminalSessionsHydrated(true);
    });
    return unsubscribe;
  }, []);

  const navigateToChat = () => {
    if (primaryThreadId) {
      router.push(`/projects/${projectSlug}/thread/${encodeURIComponent(primaryThreadId)}`);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Chat */}
      <ToolPathCard
        icon={<MessageSquare className="w-4 h-4" />}
        title="Chat"
        accentClass="text-indigo-400"
        onClick={navigateToChat}
        badge={
          threadCount > 0 ? (
            <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
              {threadCount}
            </span>
          ) : undefined
        }
      >
        {threads === null ? (
          <div className="space-y-1.5">
            {[1, 2].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-[var(--muted)]" />)}
          </div>
        ) : threads.length === 0 ? (
          <p className="text-[var(--muted-foreground)]">No threads yet</p>
        ) : (
          <div className="space-y-1">
            {threads.map((t) => (
              <div key={t.id} className="flex items-center gap-2 truncate text-[var(--foreground)]">
                <MessageSquare className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" />
                <span className="truncate">{t.title}</span>
              </div>
            ))}
          </div>
        )}
      </ToolPathCard>

      {/* Terminal */}
      <ToolPathCard
        icon={<TerminalSquare className="w-4 h-4" />}
        title="Terminal"
        accentClass="text-emerald-400"
        onClick={() => router.push(`/projects/${projectSlug}/terminal`)}
        badge={
          terminalSessionsHydrated && terminalSessions.length > 0 ? (
            <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
              {terminalSessions.length}
            </span>
          ) : undefined
        }
      >
        {!terminalSessionsHydrated ? (
          <div className="space-y-1.5">
            {[1, 2].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-[var(--muted)]" />)}
          </div>
        ) : terminalSessions.length === 0 ? (
          <p className="text-[var(--muted-foreground)]">No sessions yet</p>
        ) : (
          <div className="space-y-1">
            <p className="text-[var(--foreground)]">
              {formatSavedSessionCount(terminalSessions.length)}
            </p>
            <p className="truncate text-[var(--muted-foreground)]">
              Latest: {latestTerminalSession?.title ?? "Untitled terminal"}
            </p>
          </div>
        )}
      </ToolPathCard>

      {/* Linear */}
      <ToolPathCard
        icon={<TrackerIcon trackerType="linear" className="w-4 h-4" />}
        title="Tasks"
        accentClass="text-blue-400"
        onClick={() => router.push(`/projects/${projectSlug}/tracking`)}
        badge={
          !trackerLoading ? (
            connected ? (
              <span className="rounded-full border border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] px-2 py-0.5 text-[11px] text-[var(--status-completed-text)]">
                Connected
              </span>
            ) : (
              <span className="rounded-full border border-[var(--border)] bg-[var(--secondary)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]">
                Connect
              </span>
            )
          ) : undefined
        }
      >
        {!trackerLoading && !connected && (
          <p className="text-[var(--muted-foreground)]">Connect to see issues</p>
        )}
      </ToolPathCard>
    </div>
  );
}
