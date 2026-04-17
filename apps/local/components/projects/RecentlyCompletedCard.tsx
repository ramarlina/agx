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
  trackerType: string | null;
}

interface Participant {
  id: string;
  name: string;
}

interface TeamEntry {
  id: string;
  name: string;
  agents: Array<{ agent_id: string }>;
}

interface RecentlyCompletedCardProps {
  projectId: string;
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
  projectId,
  projectSlug,
  projectThreadIds = [],
}: RecentlyCompletedCardProps) {
  const router = useRouter();
  const [completedProcesses, setCompletedProcesses] = useState<EnrichedProcessEntry[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [teams, setTeams] = useState<TeamEntry[]>([]);

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

  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/teams`);
      if (!res.ok) return;
      const data = await res.json();
      setTeams(Array.isArray(data) ? data : []);
    } catch {
      // silent
    }
  }, [projectId]);

  useEffect(() => {
    fetchParticipants();
    fetchTeams();
  }, [fetchParticipants, fetchTeams]);

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

  // Build agent → team lookup
  const agentTeamMap = new Map<string, { id: string; name: string }>();
  for (const team of teams) {
    for (const agent of team.agents) {
      agentTeamMap.set(agent.agent_id, { id: team.id, name: team.name });
    }
  }

  if (completedProcesses.length === 0) return null;

  return (
    <section className="col-span-full overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Recently Completed
          </div>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Last {completedProcesses.length} completed{" "}
            {completedProcesses.length === 1 ? "task" : "tasks"}.
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--secondary)]">
            <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
              <th className="px-4 py-3 font-medium">Agent</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Thread</th>
              <th className="px-4 py-3 font-medium">Last active</th>
            </tr>
          </thead>
          <tbody>
            {completedProcesses.map((process) => (
              <tr
                key={`${process.workspaceId}-${process.threadId}-${process.agentId}`}
                className="cursor-pointer border-t border-[var(--border)] text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
                onClick={() =>
                  router.push(
                    process.linearIssueId && process.linearRunId
                      ? `/projects/${projectSlug}/${process.trackerType ?? "linear"}?issue=${encodeURIComponent(process.linearIssueId)}&run=${encodeURIComponent(process.linearRunId)}`
                      : `/projects/${projectSlug}/thread/${encodeURIComponent(process.workspaceId)}${process.threadId ? `?open=${encodeURIComponent(process.threadId)}` : ""}`
                  )
                }
              >
                <td className="px-4 py-3 text-[var(--foreground)]">{getAgentName(process.agentId)}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--secondary)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted-foreground)]">
                    <CheckCircle2 className="h-3 w-3" />
                    Done
                  </span>
                </td>
                <td className="max-w-[24rem] px-4 py-3 text-[var(--muted-foreground)]">
                  <span className="block truncate">{formatActivityThread(process)}</span>
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">{formatLastActive(process.lastActivity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
