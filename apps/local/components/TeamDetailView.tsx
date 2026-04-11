"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Badge,
  Loader2,
  Pencil,
  Trash2,
  UserMinus,
  Users,
  X,
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

interface TeamDetailViewProps {
  projectId: string;
  teamId: string;
  onTeamDeleted?: () => void;
  onTeamUpdated?: () => void;
  onTeamMissing?: () => void;
}

export default function TeamDetailView({
  projectId,
  teamId,
  onTeamDeleted,
  onTeamUpdated,
  onTeamMissing,
}: TeamDetailViewProps) {
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline name editing
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [savingName, setSavingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Removing agent
  const [removingAgentId, setRemovingAgentId] = useState<string | null>(null);

  const fetchTeam = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/teams/${teamId}`
      );
      if (res.status === 404) {
        onTeamMissing?.();
        return;
      }
      if (!res.ok) throw new Error(`Failed to load team (${res.status})`);
      const data = await res.json();
      setTeam(data.team);
      setNameValue(data.team.name);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [onTeamMissing, projectId, teamId]);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  const handleSaveName = async () => {
    if (!team || nameValue.trim() === team.name) {
      setEditingName(false);
      return;
    }
    if (!nameValue.trim()) {
      setNameValue(team.name);
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/teams/${teamId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nameValue.trim() }),
        }
      );
      if (!res.ok) throw new Error("Failed to update team name");
      setTeam((prev) => (prev ? { ...prev, name: nameValue.trim() } : prev));
      onTeamUpdated?.();
    } catch {
      setNameValue(team.name);
    } finally {
      setSavingName(false);
      setEditingName(false);
    }
  };

  const handleRemoveAgent = async (agentId: string) => {
    setRemovingAgentId(agentId);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/teams/${teamId}/agents?agentId=${encodeURIComponent(agentId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to remove agent");
      setTeam((prev) =>
        prev
          ? { ...prev, agents: prev.agents.filter((a) => a.agent_id !== agentId) }
          : prev
      );
      onTeamUpdated?.();
    } catch {
      // silently fail — user can retry
    } finally {
      setRemovingAgentId(null);
    }
  };

  const handleDeleteTeam = async () => {
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/teams/${teamId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to delete team");
      onTeamDeleted?.();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  // --- Loading state ---
  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-zinc-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading team...
      </div>
    );
  }

  // --- Error state ---
  if (error || !team) {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-2 text-zinc-400">
        <AlertTriangle className="w-5 h-5 text-red-400" />
        <p className="text-sm text-red-400">{error ?? "Team not found"}</p>
        <button
          onClick={fetchTeam}
          className="text-xs text-zinc-500 hover:text-zinc-300 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  // --- Loaded ---
  return (
    <div className="flex flex-col gap-4 p-4 rounded-lg border border-zinc-800 bg-zinc-900/60">
      {/* Header: team name (editable) */}
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-zinc-500 shrink-0" />
        {editingName ? (
          <input
            ref={nameInputRef}
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveName();
              if (e.key === "Escape") {
                setNameValue(team.name);
                setEditingName(false);
              }
            }}
            disabled={savingName}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-sm text-zinc-100 outline-none focus:border-blue-500"
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="flex items-center gap-1.5 group text-left flex-1 min-w-0"
          >
            <span className="text-sm font-medium text-zinc-100 truncate">
              {team.name}
            </span>
            <Pencil className="w-3 h-3 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        )}
      </div>

      {/* Template origin badge */}
      {team.template_id && (
        <div className="flex items-center gap-1.5">
          <Badge className="w-3 h-3 text-zinc-500" />
          <span className="text-xs text-zinc-500">
            From: <span className="text-zinc-400">{team.template_id}</span>
          </span>
        </div>
      )}

      {/* Agent list */}
      <div className="flex flex-col gap-1">
        <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
          Agents ({team.agents.length})
        </h4>
        {team.agents.length === 0 ? (
          <p className="text-xs text-zinc-600 italic px-1">No agents assigned</p>
        ) : (
          team.agents
            .sort((a, b) => a.routing_order - b.routing_order)
            .map((agent) => (
              <div
                key={agent.agent_id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800/60 group"
              >
                {/* Routing order */}
                <span className="text-[10px] text-zinc-600 font-mono w-4 text-right shrink-0">
                  #{agent.routing_order}
                </span>

                {/* Role badge */}
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 shrink-0">
                  {agent.role_key}
                </span>

                {/* Agent ID */}
                <span className="text-xs text-zinc-300 truncate flex-1">
                  {agent.agent_id}
                </span>

                {/* Remove button */}
                <button
                  onClick={() => handleRemoveAgent(agent.agent_id)}
                  disabled={removingAgentId === agent.agent_id}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400 disabled:opacity-50 shrink-0"
                  title="Remove agent"
                >
                  {removingAgentId === agent.agent_id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <X className="w-3 h-3" />
                  )}
                </button>
              </div>
            ))
        )}
      </div>

      {/* Delete team */}
      <div className="pt-2 border-t border-zinc-800">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-400 flex-1">
              Delete this team?
            </span>
            <button
              onClick={handleDeleteTeam}
              disabled={deleting}
              className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Confirm"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Delete Team
          </button>
        )}
      </div>
    </div>
  );
}
