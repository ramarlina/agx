"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  Loader2,
  Plus,
  Users,
} from "lucide-react";

interface TeamAgent {
  team_id: string;
  agent_id: string;
  role_key: string;
  routing_order: number;
}

interface Team {
  id: string;
  name: string;
  template_id?: string | null;
  metadata?: Record<string, unknown>;
  agents: TeamAgent[];
}

interface Participant {
  id: string;
  name: string;
}

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

interface TeamsViewProps {
  projectId: string;
  projectSlug: string;
  projectAgents: Array<{ agent_id: string; routing_order: number }>;
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

export function TeamsView({
  projectId,
  projectSlug,
  projectAgents,
  projectThreadIds = [],
}: TeamsViewProps) {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeProcesses, setActiveProcesses] = useState<EnrichedProcessEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchTeams = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/teams`);
      if (!res.ok) throw new Error(`Failed to load teams (${res.status})`);
      const data = await res.json();
      setTeams(data.teams ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

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
    fetchTeams();
    fetchParticipants();
  }, [fetchTeams, fetchParticipants]);

  useEffect(() => {
    let cancelled = false;
    const normalizedProjectSlug = projectSlug.trim().toLowerCase();
    const projectThreadIdSet = new Set(projectThreadIds.map((id) => id.trim()).filter(Boolean));

    const poll = async () => {
      try {
        const res = await fetch("/api/processes?enrich=1");
        if (!res.ok) return;
        const data: EnrichedProcessEntry[] = await res.json();
        if (cancelled) return;
        const relevant = data
          .filter((process) => process.state === "spawning" || process.state === "running")
          .filter((process) => {
            const processProjectSlug = process.projectSlug.trim().toLowerCase();
            if (processProjectSlug && processProjectSlug === normalizedProjectSlug) return true;
            return projectThreadIdSet.has(process.workspaceId) || projectThreadIdSet.has(process.threadId);
          })
          .sort((a, b) => b.lastActivity - a.lastActivity);
        setActiveProcesses(relevant);
      } catch {
        // keep the last known activity state
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

  function agentName(agentId: string): string {
    return participantMap.get(agentId) || agentId.slice(0, 8);
  }

  const activeAgentIds = new Set(activeProcesses.map((process) => process.agentId));
  const activeAgentCount = activeAgentIds.size;

  // Compute unassigned agents
  const assignedAgentIds = new Set(teams.flatMap((t) => t.agents.map((a) => a.agent_id)));
  const unassignedAgents = projectAgents.filter((a) => !assignedAgentIds.has(a.agent_id));
  const unassignedAgentIdSet = new Set(unassignedAgents.map((agent) => agent.agent_id));
  const unassignedActiveProcesses = activeProcesses.filter((process) => unassignedAgentIdSet.has(process.agentId));
  const unassignedActiveAgentCount = new Set(
    unassignedActiveProcesses.map((process) => process.agentId)
  ).size;
  const activeTeamCount = teams.filter((team) =>
    team.agents.some((agent) => activeAgentIds.has(agent.agent_id))
  ).length;
  const teamActivityRows = teams.flatMap((team) => {
    const teamAgentIds = new Set(team.agents.map((agent) => agent.agent_id));
    return activeProcesses
      .filter((process) => teamAgentIds.has(process.agentId))
      .map((process) => ({
        key: `${team.id}-${process.workspaceId}-${process.threadId}-${process.agentId}`,
        teamId: team.id,
        teamName: team.name,
        workspaceId: process.workspaceId,
        threadId: process.threadId,
        agentName: agentName(process.agentId),
        state: process.state,
        threadLabel: formatActivityThread(process),
        lastActiveLabel: formatLastActive(process.lastActivity),
        linearIssueId: process.linearIssueId,
        linearRunId: process.linearRunId,
      }));
  });

  // --- Loading ---
  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-[var(--muted-foreground)]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading teams...
      </div>
    );
  }

  // --- Error ---
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-12 text-[var(--muted-foreground)]">
        <AlertTriangle className="h-5 w-5 text-[var(--destructive)]" />
        <p className="text-sm text-[var(--destructive)]">{error}</p>
        <button
          onClick={fetchTeams}
          className="text-xs text-[var(--muted-foreground)] underline transition-colors hover:text-[var(--foreground)]"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            <Activity className="h-3.5 w-3.5" />
            Live Team Activity
          </div>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {activeAgentCount > 0
              ? `${activeAgentCount} active ${activeAgentCount === 1 ? "agent" : "agents"} across ${activeTeamCount} ${activeTeamCount === 1 ? "team" : "teams"}`
              : "No agents are active right now."}
          </p>
        </div>
        <button
          onClick={() => router.push(`/projects/${projectSlug}/teams/new`)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Team
        </button>
      </div>

      {/* Team cards */}
      {teams.length === 0 ? (
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center">
          <Users className="mx-auto mb-3 h-8 w-8 text-[var(--app-shell-soft-text)]" />
          <p className="mb-1 text-sm text-[var(--muted-foreground)]">No teams yet</p>
          <p className="text-xs text-[var(--app-shell-soft-text)]">
            Add a team to organize your agents into specialized roles.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teams.map((team) => {
            const teamAgentIds = new Set(team.agents.map((agent) => agent.agent_id));
            const teamActiveProcesses = activeProcesses.filter((process) => teamAgentIds.has(process.agentId));
            const liveAgentCount = new Set(teamActiveProcesses.map((process) => process.agentId)).size;

            return (
              <div
                key={team.id}
                className={`rounded-2xl border p-4 flex flex-col gap-3 cursor-pointer transition-colors group ${
                  teamActiveProcesses.length > 0
                    ? "border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] shadow-[0_0_0_1px_var(--status-completed-border)] hover:border-[var(--status-completed)]"
                    : "border-[var(--card-border)] bg-[var(--card-bg)] hover:border-[var(--card-hover-border)] hover:bg-[var(--secondary)]"
                }`}
                onClick={() => router.push(`/projects/${projectSlug}/teams/${team.id}`)}
              >
                {/* Team header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Users className={`h-4 w-4 shrink-0 ${teamActiveProcesses.length > 0 ? "text-[var(--status-completed)]" : "text-[var(--muted-foreground)]"}`} />
                    <span className="truncate text-sm font-medium text-[var(--foreground)]">
                      {team.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {liveAgentCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--status-completed-text)]">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        {liveAgentCount} live
                      </span>
                    )}
                    {team.template_id && (
                      <span className="rounded-full border border-[var(--tone-neutral-border)] bg-[var(--tone-neutral-bg)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--tone-neutral)]">
                        {team.template_id}
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 text-[var(--app-shell-soft-text)] opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                </div>

                {/* Agent count */}
                <p className="text-xs text-[var(--muted-foreground)]">
                  {team.agents.length} agent{team.agents.length !== 1 ? "s" : ""}
                  {liveAgentCount > 0 ? ` · ${liveAgentCount} active now` : ""}
                </p>

                {/* Agent avatars */}
                {team.agents.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {team.agents
                      .sort((a, b) => a.routing_order - b.routing_order)
                      .map((agent) => {
                        const isActive = activeAgentIds.has(agent.agent_id);
                        return (
                          <span
                            key={agent.agent_id}
                            title={`${agentName(agent.agent_id)} (${agent.role_key})`}
                            className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${
                              isActive
                                ? "border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] text-[var(--status-completed-text)]"
                                : "border-[var(--border)] bg-[var(--secondary)] text-[var(--foreground)]"
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-emerald-400" : "bg-[var(--muted-foreground)]"}`} />
                            {agentName(agent.agent_id)}
                          </span>
                        );
                      })}
                  </div>
                )}

              </div>
            );
          })}
        </div>
      )}

      {teamActivityRows.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                <Activity className="h-3.5 w-3.5" />
                Working Now
              </div>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Live activity across all teams.
              </p>
            </div>
            <span className="rounded-full border border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--status-completed-text)]">
              {teamActivityRows.length} live {teamActivityRows.length === 1 ? "entry" : "entries"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[var(--secondary)]">
                <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                  <th className="px-4 py-3 font-medium">Team</th>
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Thread</th>
                  <th className="px-4 py-3 font-medium">Last active</th>
                </tr>
              </thead>
              <tbody>
                {teamActivityRows.map((row) => (
                  <tr
                    key={row.key}
                    className="cursor-pointer border-t border-[var(--border)] text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
                    onClick={() =>
                      router.push(
                        row.linearIssueId && row.linearRunId
                          ? `/projects/${projectSlug}/linear?issue=${encodeURIComponent(row.linearIssueId)}&run=${encodeURIComponent(row.linearRunId)}`
                          : `/projects/${projectSlug}/thread/${encodeURIComponent(row.workspaceId)}${row.threadId ? `?open=${encodeURIComponent(row.threadId)}` : ""}`
                      )
                    }
                  >
                    <td className="px-4 py-3">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          router.push(`/projects/${projectSlug}/teams/${row.teamId}`);
                        }}
                        className="text-left font-medium text-[var(--foreground)] transition-colors hover:text-[var(--primary)]"
                      >
                        {row.teamName}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-[var(--foreground)]">{row.agentName}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--status-completed-text)]">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        {row.state === "spawning" ? "Starting" : "Working"}
                      </span>
                    </td>
                    <td className="max-w-[24rem] px-4 py-3 text-[var(--muted-foreground)]">
                      <span className="block truncate">{row.threadLabel}</span>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">{row.lastActiveLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Unassigned agents */}
      {unassignedAgents.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--status-blocked-border)] bg-[var(--status-blocked-bg)] p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--status-blocked)]" />
            <span className="text-sm font-medium text-[var(--foreground)]">
              Unassigned Agents
            </span>
            <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
              {unassignedAgents.length}
            </span>
            {unassignedActiveAgentCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--status-completed-text)]">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {unassignedActiveAgentCount} live
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            These agents are in the project but not assigned to any team.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unassignedAgents.map((agent) => (
              <span
                key={agent.agent_id}
                className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${
                  activeAgentIds.has(agent.agent_id)
                    ? "border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] text-[var(--status-completed-text)]"
                    : "border-[var(--border)] bg-[var(--secondary)] text-[var(--foreground)]"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    activeAgentIds.has(agent.agent_id) ? "bg-emerald-400" : "bg-[var(--muted-foreground)]"
                  }`}
                />
                {agentName(agent.agent_id)}
              </span>
            ))}
          </div>
          {unassignedActiveProcesses.length > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] p-3">
              <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--status-completed-text)]">
                <Activity className="h-3.5 w-3.5" />
                Unassigned Activity
              </div>
              {unassignedActiveProcesses.slice(0, 3).map((process) => (
                <div key={`unassigned-${process.workspaceId}-${process.threadId}-${process.agentId}`} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate text-xs text-[var(--foreground)]">
                      <span className="font-medium">{agentName(process.agentId)}</span>{" "}
                      {process.state === "spawning" ? "is starting up" : "is working"}
                    </p>
                    <p className="truncate text-[11px] text-[var(--muted-foreground)]">
                      {formatActivityThread(process)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--card-hover-border)] hover:text-[var(--foreground)]"
              onClick={() => router.push(`/projects/${projectSlug}/teams/adopt`)}
            >
              Adopt into team
            </button>
            <button
              className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--card-hover-border)] hover:text-[var(--foreground)]"
              onClick={() => router.push(`/projects/${projectSlug}/teams/replace`)}
            >
              Replace with preset
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
