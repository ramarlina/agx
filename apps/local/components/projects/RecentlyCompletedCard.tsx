"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

interface EnrichedProcessEntry {
  workspaceId: string;
  threadId: string;
  agentId: string;
  state: "spawning" | "running" | "done" | "error" | "killed";
  lastActivity: number;
  projectSlug: string;
  threadTitle: string | null;
  linearIssueId: string | null;
  linearRunId: string | null;
}

interface Participant {
  id: string;
  name: string;
}

interface RecentlyCompletedCardProps {
  projectSlug: string;
  projectThreadIds?: string[];
}

function formatActivityThread(process: EnrichedProcessEntry): string {
  if (process.threadTitle?.trim()) return process.threadTitle.trim();
  if (process.threadId?.trim()) return `Thread ${process.threadId.slice(0, 12)}...`;
  return "Main thread";
}

function formatLastActive(lastActivity: number): string {
  const elapsedMs = Date.now() - lastActivity;
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (elapsedSeconds < 5) return "Just now";
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

export function RecentlyCompletedCard({
  projectSlug,
  projectThreadIds = [],
}: RecentlyCompletedCardProps) {
  const router = useRouter();
  const [completedProcesses, setCompletedProcesses] = useState<EnrichedProcessEntry[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);

  const fetchParticipants = useCallback(async () => {
    try {
      const res = await fetch("/api/participants");
      if (!res.ok) return;
      const data = await res.json();
      setParticipants(Array.isArray(data) ? data : data.participants ?? []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchParticipants();
  }, [fetchParticipants]);

  useEffect(() => {
    let cancelled = false;
    const normalizedSlug = projectSlug.trim().toLowerCase();
    const threadIdSet = new Set(
      projectThreadIds.map((id) => id.trim()).filter(Boolean)
    );

    const poll = async () => {
      try {
        const res = await fetch("/api/processes?enrich=1");
        if (!res.ok || cancelled) return;
        const data: EnrichedProcessEntry[] = await res.json();
        if (cancelled) return;
        const relevant = data
          .filter((p) => p.state === "done")
          .filter((p) => {
            const slug = p.projectSlug.trim().toLowerCase();
            if (slug && slug === normalizedSlug) return true;
            return threadIdSet.has(p.workspaceId) || threadIdSet.has(p.threadId);
          })
          .sort((a, b) => b.lastActivity - a.lastActivity)
          .slice(0, 10);
        setCompletedProcesses(relevant);
      } catch {
        // keep last known state
      }
    };

    void poll();
    const interval = setInterval(poll, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectSlug, projectThreadIds]);

  const participantMap = new Map(participants.map((p) => [p.id, p.name]));
  const getAgentName = (agentId: string) =>
    participantMap.get(agentId) || agentId.slice(0, 8);

  if (completedProcesses.length === 0) return null;

  return (
    <section className="col-span-full overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Recently Completed
        </div>
      </div>

      <div className="divide-y divide-[var(--border)]">
        {completedProcesses.map((process) => (
          <div
            key={`${process.workspaceId}-${process.threadId}-${process.agentId}`}
            className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-[var(--secondary)]"
            onClick={() =>
              router.push(
                process.linearIssueId && process.linearRunId
                  ? `/projects/${projectSlug}/linear?issue=${encodeURIComponent(process.linearIssueId)}&run=${encodeURIComponent(process.linearRunId)}`
                  : `/projects/${projectSlug}/thread/${encodeURIComponent(process.workspaceId)}${process.threadId ? `?open=${encodeURIComponent(process.threadId)}` : ""}`
              )
            }
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
            <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">
              {formatActivityThread(process)}
            </span>
            <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
              {getAgentName(process.agentId)}
            </span>
            <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
              {formatLastActive(process.lastActivity)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
