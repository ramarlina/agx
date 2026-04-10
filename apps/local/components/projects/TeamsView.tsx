"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  Plus,
  Settings,
  Users,
} from "lucide-react";
import TeamPickerModal from "@/components/TeamPickerModal";
import { TeamDetailView } from "@/components/TeamDetailView";
import { AdoptAgentsModal } from "@/components/projects/AdoptAgentsModal";
import { ReplaceAgentsModal } from "@/components/projects/ReplaceAgentsModal";

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

interface TeamsViewProps {
  projectId: string;
  projectSlug: string;
  projectAgents: Array<{ agent_id: string; routing_order: number }>;
}

export function TeamsView({ projectId, projectSlug, projectAgents }: TeamsViewProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [manageTeamId, setManageTeamId] = useState<string | null>(null);
  const [showAdopt, setShowAdopt] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [unassignedDetails, setUnassignedDetails] = useState<Array<{ id: string; name: string; style: string; skills: Array<{ file: string }> }>>([]);

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
      setParticipants(data.participants ?? []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchTeams();
    fetchParticipants();
  }, [fetchTeams, fetchParticipants]);

  const participantMap = new Map(participants.map((p) => [p.id, p.name]));

  function agentName(agentId: string): string {
    return participantMap.get(agentId) || agentId.slice(0, 8);
  }

  const fetchUnassignedDetails = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/agents/unassigned`);
      if (res.ok) {
        const data = await res.json();
        setUnassignedDetails(data.agents ?? []);
      }
    } catch { /* silent */ }
  }, [projectId]);

  // Compute unassigned agents
  const assignedAgentIds = new Set(teams.flatMap((t) => t.agents.map((a) => a.agent_id)));
  const unassignedAgents = projectAgents.filter((a) => !assignedAgentIds.has(a.agent_id));

  // Existing template IDs for the picker
  const existingTemplateIds = teams
    .map((t) => t.template_id)
    .filter((id): id is string => !!id);

  // --- Loading ---
  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-zinc-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading teams...
      </div>
    );
  }

  // --- Error ---
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-12 gap-2 text-zinc-400">
        <AlertTriangle className="w-5 h-5 text-red-400" />
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={fetchTeams}
          className="text-xs text-zinc-500 hover:text-zinc-300 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-zinc-400" />
          <h1 className="text-lg font-semibold text-zinc-100">Teams</h1>
          {teams.length > 0 && (
            <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-400">
              {teams.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowTeamPicker(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Team
        </button>
      </div>

      {/* Team cards */}
      {teams.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <Users className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
          <p className="text-sm text-zinc-400 mb-1">No teams yet</p>
          <p className="text-xs text-zinc-500">
            Add a team to organize your agents into specialized roles.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teams.map((team) => (
            <div
              key={team.id}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 flex flex-col gap-3"
            >
              {/* Team header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Users className="w-4 h-4 text-zinc-400 shrink-0" />
                  <span className="text-sm font-medium text-zinc-100 truncate">
                    {team.name}
                  </span>
                </div>
                {team.template_id && (
                  <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700 shrink-0">
                    {team.template_id}
                  </span>
                )}
              </div>

              {/* Agent count */}
              <p className="text-xs text-zinc-500">
                {team.agents.length} agent{team.agents.length !== 1 ? "s" : ""}
              </p>

              {/* Agent avatars */}
              {team.agents.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {team.agents
                    .sort((a, b) => a.routing_order - b.routing_order)
                    .map((agent) => (
                      <span
                        key={agent.agent_id}
                        title={`${agentName(agent.agent_id)} (${agent.role_key})`}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                        {agentName(agent.agent_id)}
                      </span>
                    ))}
                </div>
              )}

              {/* Manage button */}
              <div className="pt-2 border-t border-zinc-800 mt-auto">
                <button
                  type="button"
                  onClick={() => setManageTeamId(manageTeamId === team.id ? null : team.id)}
                  className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <Settings className="w-3 h-3" />
                  {manageTeamId === team.id ? "Close" : "Manage"}
                </button>
              </div>
              {manageTeamId === team.id && (
                <div className="mt-3 border-t border-zinc-800 pt-3">
                  <TeamDetailView
                    projectId={projectId}
                    teamId={team.id}
                    onTeamDeleted={() => { setManageTeamId(null); fetchTeams(); }}
                    onTeamUpdated={fetchTeams}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Unassigned agents */}
      {unassignedAgents.length > 0 && (
        <div className="rounded-2xl border border-amber-800/50 bg-amber-900/10 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="text-sm font-medium text-zinc-200">
              Unassigned Agents
            </span>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {unassignedAgents.length}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            These agents are in the project but not assigned to any team.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unassignedAgents.map((agent) => (
              <span
                key={agent.agent_id}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 shrink-0" />
                {agentName(agent.agent_id)}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              className="text-xs px-3 py-1 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
              onClick={() => { fetchUnassignedDetails(); setShowAdopt(true); }}
            >
              Adopt into team
            </button>
            <button
              className="text-xs px-3 py-1 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
              onClick={() => { fetchUnassignedDetails(); setShowReplace(true); }}
            >
              Replace with preset
            </button>
          </div>
        </div>
      )}

      {/* Team Picker Modal */}
      {showTeamPicker && (
        <TeamPickerModal
          projectId={projectId}
          existingTeamTemplateIds={existingTemplateIds}
          onClose={() => setShowTeamPicker(false)}
          onTeamCreated={fetchTeams}
        />
      )}

      {/* Adopt Modal */}
      {showAdopt && (
        <AdoptAgentsModal
          projectId={projectId}
          unassignedAgents={unassignedDetails}
          onClose={() => setShowAdopt(false)}
          onAdopted={() => { setShowAdopt(false); fetchTeams(); }}
        />
      )}

      {/* Replace Modal */}
      {showReplace && (
        <ReplaceAgentsModal
          projectId={projectId}
          unassignedAgents={unassignedDetails.map((a) => ({ id: a.id, name: a.name }))}
          onClose={() => setShowReplace(false)}
          onReplaced={() => { setShowReplace(false); fetchTeams(); }}
        />
      )}
    </div>
  );
}
