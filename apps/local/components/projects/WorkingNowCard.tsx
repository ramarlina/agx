"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";

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
  responseMessageId: string | null;
}

interface Participant {
  id: string;
  name: string;
}

interface WorkingNowCardProps {
  projectSlug: string;
  projectThreadIds?: string[];
}

function resolveActivityHref(
  projectSlug: string,
  activity: {
    workspaceId: string;
    threadId: string;
    linearIssueId: string | null;
    linearRunId: string | null;
    trackerType: string | null;
    responseMessageId: string | null;
  }
): string {
  if (activity.linearIssueId && activity.linearRunId) {
    const base = `/projects/${projectSlug}/tracking/${activity.trackerType ?? "linear"}?issue=${encodeURIComponent(activity.linearIssueId)}&run=${encodeURIComponent(activity.linearRunId)}`;
    return activity.responseMessageId
      ? `${base}&message=${encodeURIComponent(activity.responseMessageId)}`
      : base;
  }
  const workspaceId = activity.workspaceId ?? "";
  const threadId = activity.threadId ?? "";
  const objectivePrefix = "objective-chat:";
  const objectiveSource = workspaceId.startsWith(objectivePrefix)
    ? workspaceId
    : threadId.startsWith(objectivePrefix)
      ? threadId
      : null;
  if (objectiveSource) {
    const objectiveId = objectiveSource.slice(objectivePrefix.length);
    const params = new URLSearchParams();
    if (threadId && threadId !== workspaceId) params.set("session", threadId);
    if (activity.responseMessageId) params.set("message", activity.responseMessageId);
    const qs = params.toString();
    return `/projects/${projectSlug}/objectives/${encodeURIComponent(objectiveId)}${qs ? `?${qs}` : ""}`;
  }
  const trackerRunPrefix = "tracker-run:";
  if (workspaceId.startsWith(trackerRunPrefix)) {
    const runId = activity.linearRunId ?? workspaceId.slice(trackerRunPrefix.length);
    const params = new URLSearchParams();
    if (activity.linearIssueId) params.set("issue", activity.linearIssueId);
    params.set("run", runId);
    if (activity.responseMessageId) params.set("message", activity.responseMessageId);
    return `/projects/${projectSlug}/tracking/${activity.trackerType ?? "linear"}?${params.toString()}`;
  }
  const params = new URLSearchParams();
  if (threadId) params.set("open", threadId);
  if (activity.responseMessageId) params.set("message", activity.responseMessageId);
  const qs = params.toString();
  return `/projects/${projectSlug}/thread/${encodeURIComponent(workspaceId)}${qs ? `?${qs}` : ""}`;
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

interface AgentGroup {
  agentId: string;
  agentName: string;
  activities: Array<{
    key: string;
    workspaceId: string;
    threadId: string;
    state: "spawning" | "running";
    threadLabel: string;
    lastActiveLabel: string;
    lastActivity: number;
    linearIssueId: string | null;
    linearRunId: string | null;
    trackerType: string | null;
    responseMessageId: string | null;
  }>;
}

export function WorkingNowCard({
  projectSlug,
  projectThreadIds = [],
}: WorkingNowCardProps) {
  const router = useRouter();
  const [activeProcesses, setActiveProcesses] = useState<EnrichedProcessEntry[]>([]);
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
          .filter((p) => p.state === "spawning" || p.state === "running")
          .filter((p) => {
            const slug = p.projectSlug.trim().toLowerCase();
            if (slug && slug === normalizedSlug) return true;
            return threadIdSet.has(p.workspaceId) || threadIdSet.has(p.threadId);
          })
          .sort((a, b) => b.lastActivity - a.lastActivity);
        setActiveProcesses(relevant);
      } catch {
        // keep last known state
      }
    };

    void poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectSlug, projectThreadIds]);

  const participantMap = new Map(participants.map((p) => [p.id, p.name]));
  const getAgentName = (agentId: string) =>
    participantMap.get(agentId) || agentId.slice(0, 8);

  // Group by agent
  const agentGroups: AgentGroup[] = [];
  const agentMap = new Map<string, AgentGroup>();

  for (const process of activeProcesses) {
    let group = agentMap.get(process.agentId);
    if (!group) {
      group = {
        agentId: process.agentId,
        agentName: getAgentName(process.agentId),
        activities: [],
      };
      agentMap.set(process.agentId, group);
      agentGroups.push(group);
    }
    group.activities.push({
      key: `${process.workspaceId}-${process.threadId}-${process.agentId}`,
      workspaceId: process.workspaceId,
      threadId: process.threadId,
      state: process.state as "spawning" | "running",
      threadLabel: formatActivityThread(process),
      lastActiveLabel: formatLastActive(process.lastActivity),
      lastActivity: process.lastActivity,
      linearIssueId: process.linearIssueId,
      linearRunId: process.linearRunId,
      trackerType: process.trackerType,
      responseMessageId: process.responseMessageId,
    });
  }

  if (agentGroups.length === 0) return null;

  const totalActivities = activeProcesses.length;

  return (
    <section className="col-span-full overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            <Activity className="h-3.5 w-3.5" />
            Working Now
          </div>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {agentGroups.length} {agentGroups.length === 1 ? "agent" : "agents"} active across{" "}
            {totalActivities} {totalActivities === 1 ? "thread" : "threads"}.
          </p>
        </div>
        <span className="rounded-full border border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--status-completed-text)]">
          {totalActivities} live {totalActivities === 1 ? "entry" : "entries"}
        </span>
      </div>

      <div className="divide-y divide-[var(--border)]">
        {agentGroups.map((group) => (
          <div key={group.agentId} className="px-4 py-3">
            {/* Agent header */}
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--foreground)]">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                {group.agentName}
              </span>
              {group.activities.length > 1 && (
                <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                  {group.activities.length} threads
                </span>
              )}
            </div>

            {/* Activity rows */}
            <div className="space-y-1 ml-4">
              {group.activities.map((activity) => (
                <div
                  key={activity.key}
                  className="mx-[-0.5rem] flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-[var(--secondary)]"
                  onClick={() => router.push(resolveActivityHref(projectSlug, activity))}
                >
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--status-completed-text)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {activity.state === "spawning" ? "Starting" : "Working"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">
                    {activity.threadLabel}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                    {activity.lastActiveLabel}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
