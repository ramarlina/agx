"use client";

import { use, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Cpu,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
  Zap,
  AlertTriangle,
} from "lucide-react";
import { useProjectsWithAgents } from "@/hooks/useProjects";
import { listAgentPresets, getAgentPresetBindings } from "@/lib/team-catalog";
import SearchCombo, { type ComboOption } from "@/components/SearchCombo";
import type { Participant } from "@/lib/types";
import { agentAvatarUrl, AgentForm, type AgentFormData } from "@/components/chat-ui/ParticipantBar";

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

export default function TeamDetailPage({
  params,
}: {
  params: Promise<{ slug: string; teamId: string }>;
}) {
  const { slug, teamId } = use(params);
  const router = useRouter();
  const { projects } = useProjectsWithAgents();
  const project = projects.find((p) => p.slug === slug);

  const [team, setTeam] = useState<Team | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Name editing
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [savingName, setSavingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Delete
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Remove agent
  const [removingAgentId, setRemovingAgentId] = useState<string | null>(null);

  // Add agent
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [addMode, setAddMode] = useState<"existing" | "preset" | "scratch">("existing");
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [selectedExistingId, setSelectedExistingId] = useState<string | null>(null);
  const [addingAgent, setAddingAgent] = useState(false);

  // Role editing
  const [editingRoleAgentId, setEditingRoleAgentId] = useState<string | null>(null);

  // Edit agent modal
  const [editAgentId, setEditAgentId] = useState<string | null>(null);

  const fetchTeam = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/teams/${teamId}`);
      if (!res.ok) throw new Error(`Failed to load team (${res.status})`);
      const data = await res.json();
      setTeam(data.team);
      setNameValue(data.team.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [project, teamId]);

  const fetchParticipants = useCallback(async () => {
    try {
      const res = await fetch("/api/participants");
      if (!res.ok) return;
      const data = await res.json();
      setParticipants(Array.isArray(data) ? data : data.participants ?? []);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchTeam();
    fetchParticipants();
  }, [fetchTeam, fetchParticipants]);

  // Portal breadcrumb into layout top bar
  const [breadcrumbEl, setBreadcrumbEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setBreadcrumbEl(document.getElementById("topbar-breadcrumb"));
  }, []);

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  const participantMap = useMemo(
    () => new Map(participants.map((p) => [p.id, p])),
    [participants],
  );

  const allPresets = useMemo(() => listAgentPresets(), []);

  const presetOptions: ComboOption[] = useMemo(
    () =>
      allPresets.map((p) => ({
        id: p.id,
        label: p.name,
        meta: p.skillProfileId,
      })),
    [allPresets],
  );

  const roleOptions: ComboOption[] = useMemo(
    () =>
      allPresets.map((p) => ({
        id: p.id,
        label: p.name,
        meta: p.skillProfileId,
      })),
    [allPresets],
  );

  // Unassigned agents: in project but not in any team (simplified: not in this team)
  const teamAgentIds = useMemo(
    () => new Set(team?.agents.map((a) => a.agent_id) ?? []),
    [team],
  );

  const unassignedInProject = useMemo(() => {
    if (!project) return [];
    return project.agents
      .filter((a) => !teamAgentIds.has(a.agent_id))
      .map((a) => {
        const p = participantMap.get(a.agent_id);
        return {
          id: a.agent_id,
          name: p?.name ?? a.agent_id.slice(0, 8),
          provider: p?.provider ?? "claude",
          model: p?.model ?? null,
          color: p?.color ?? "#6B7280",
        };
      });
  }, [project, teamAgentIds, participantMap]);

  const existingAgentOptions: ComboOption[] = useMemo(
    () =>
      unassignedInProject.map((a) => ({
        id: a.id,
        label: a.name,
        meta: a.provider,
      })),
    [unassignedInProject],
  );

  async function handleSaveName() {
    if (!team || !project || nameValue.trim() === team.name) {
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
      const res = await fetch(`/api/projects/${project.id}/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameValue.trim() }),
      });
      if (!res.ok) throw new Error("Failed to update team name");
      setTeam((prev) => (prev ? { ...prev, name: nameValue.trim() } : prev));
    } catch {
      if (team) setNameValue(team.name);
    } finally {
      setSavingName(false);
      setEditingName(false);
    }
  }

  async function handleRemoveAgent(agentId: string) {
    if (!project) return;
    setRemovingAgentId(agentId);
    try {
      const res = await fetch(
        `/api/projects/${project.id}/teams/${teamId}/agents?agentId=${encodeURIComponent(agentId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to remove agent");
      setTeam((prev) =>
        prev ? { ...prev, agents: prev.agents.filter((a) => a.agent_id !== agentId) } : prev,
      );
    } catch {
      /* silent */
    } finally {
      setRemovingAgentId(null);
    }
  }

  async function handleDeleteTeam() {
    if (!project) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/teams/${teamId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete team");
      router.push(`/projects/${slug}/teams`);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleAddExistingAgent() {
    if (!project || !selectedExistingId) return;
    setAddingAgent(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/teams/${teamId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: selectedExistingId, roleKey: "member" }),
      });
      if (!res.ok) throw new Error("Failed to add agent");
      setSelectedExistingId(null);
      setShowAddAgent(false);
      await fetchTeam();
    } catch {
      /* silent */
    } finally {
      setAddingAgent(false);
    }
  }

  async function handleAddFromPreset() {
    if (!project || !selectedPresetId) return;
    setAddingAgent(true);
    try {
      const preset = allPresets.find((p) => p.id === selectedPresetId);
      if (!preset) return;

      // Create agent from preset
      const bindings = getAgentPresetBindings(preset);
      const createRes = await fetch("/api/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: preset.name,
          role: preset.role,
          provider: "claude",
          model: null,
          identity: preset.identity,
          skills: bindings.map((b) => ({
            file: `${b.repo}/${b.skillId}`,
            ...(b.condition ? { condition: b.condition } : {}),
          })),
        }),
      });
      if (!createRes.ok) throw new Error("Failed to create agent");
      const created = await createRes.json();
      const agentId = created.id ?? created.participant?.id;

      // Add to project
      await fetch(`/api/projects/${project.id}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });

      // Add to team
      await fetch(`/api/projects/${project.id}/teams/${teamId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, roleKey: preset.id }),
      });

      setSelectedPresetId(null);
      setShowAddAgent(false);
      await Promise.all([fetchTeam(), fetchParticipants()]);
    } catch {
      /* silent */
    } finally {
      setAddingAgent(false);
    }
  }

  if (!project || loading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--muted-foreground)]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading team...
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--muted-foreground)]">
        <AlertTriangle className="w-5 h-5 text-[var(--destructive)]" />
        <p className="text-sm text-[var(--destructive)]">{error ?? "Team not found"}</p>
        <button onClick={fetchTeam} className="text-xs underline hover:text-[var(--foreground)]">
          Retry
        </button>
      </div>
    );
  }

  const variantId = team.metadata?.variantId as string | undefined;

  return (
    <div className="h-full overflow-y-auto">
      {/* Portal breadcrumb segments into layout top bar */}
      {breadcrumbEl &&
        createPortal(
          <>
            <span className="text-xs text-[var(--muted-foreground)]">\</span>
            <span className="text-xs text-[var(--foreground)]">{team.name}</span>
          </>,
          breadcrumbEl,
        )}

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
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
                  className="input text-lg font-bold w-full"
                />
              ) : (
                <button
                  onClick={() => setEditingName(true)}
                  className="flex items-center gap-2 group text-left"
                >
                  <h1 className="text-lg font-bold truncate">{team.name}</h1>
                  <Pencil className="w-3.5 h-3.5 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </button>
              )}
              <div className="flex items-center gap-2 mt-1">
                {team.template_id && (
                  <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--muted)] text-[var(--muted-foreground)] border border-[var(--border)]">
                    {team.template_id}
                  </span>
                )}
                {variantId && (
                  <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--muted)] text-[var(--muted-foreground)] border border-[var(--border)]">
                    {variantId}
                  </span>
                )}
                <span className="text-xs text-[var(--muted-foreground)]">
                  {team.agents.length} agent{team.agents.length !== 1 ? "s" : ""}
                </span>
              </div>
          </div>
        </div>

        {/* Agent cards */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
              Agents ({team.agents.length})
            </h2>
            <button
              onClick={() => {
                setShowAddAgent(!showAddAgent);
                setAddMode("existing");
                setSelectedExistingId(null);
                setSelectedPresetId(null);
              }}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl border border-[var(--border)] hover:bg-[var(--muted)]/50 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Agent
            </button>
          </div>

          {/* Add agent panel */}
          {showAddAgent && (
            <div
              className="mb-4 p-4 rounded-2xl space-y-4"
              style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
            >
              <div className="flex gap-2">
                <button
                  onClick={() => setAddMode("existing")}
                  className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                    addMode === "existing"
                      ? "bg-[var(--primary)] text-white"
                      : "bg-[var(--card-bg)] border border-[var(--border)] text-[var(--muted-foreground)]"
                  }`}
                >
                  Existing Agent
                </button>
                <button
                  onClick={() => setAddMode("preset")}
                  className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                    addMode === "preset"
                      ? "bg-[var(--primary)] text-white"
                      : "bg-[var(--card-bg)] border border-[var(--border)] text-[var(--muted-foreground)]"
                  }`}
                >
                  From Preset
                </button>
                <button
                  onClick={() => setAddMode("scratch")}
                  className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                    addMode === "scratch"
                      ? "bg-[var(--primary)] text-white"
                      : "bg-[var(--card-bg)] border border-[var(--border)] text-[var(--muted-foreground)]"
                  }`}
                >
                  From Scratch
                </button>
              </div>

              {addMode === "scratch" ? (
                <AgentForm
                  title="Create agent"
                  initial={{ name: "", role: "", provider: "claude", model: "", identity: "", skills: [], skillBindings: [] }}
                  submitLabel="Create & Add"
                  onSubmit={async (data) => {
                    if (!project) return;
                    setAddingAgent(true);
                    try {
                      const createRes = await fetch("/api/participants", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: data.name,
                          role: data.role || null,
                          provider: data.provider,
                          model: data.model || null,
                          color: data.color,
                          ...(data.identity ? { identity: data.identity } : {}),
                          skills: data.skills ?? [],
                          skillBindings: data.skillBindings ?? [],
                        }),
                      });
                      if (!createRes.ok) throw new Error("Failed to create agent");
                      const created = await createRes.json();
                      const agentId = created.id ?? created.participant?.id;
                      await fetch(`/api/projects/${project.id}/agents`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ agentId }),
                      });
                      await fetch(`/api/projects/${project.id}/teams/${teamId}/agents`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ agentId, roleKey: "member" }),
                      });
                      setShowAddAgent(false);
                      await Promise.all([fetchTeam(), fetchParticipants()]);
                    } catch {
                      /* silent */
                    } finally {
                      setAddingAgent(false);
                    }
                  }}
                  onCancel={() => setShowAddAgent(false)}
                />
              ) : addMode === "existing" ? (
                <div className="space-y-3">
                  {existingAgentOptions.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)]">
                      No unassigned agents in this project.
                    </p>
                  ) : (
                    <SearchCombo
                      options={existingAgentOptions}
                      value={selectedExistingId}
                      onChange={setSelectedExistingId}
                      placeholder="Select an agent..."
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleAddExistingAgent}
                      disabled={!selectedExistingId || addingAgent}
                      className="btn-primary px-4 py-1.5 text-xs flex items-center gap-1.5"
                    >
                      {addingAgent ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      Add
                    </button>
                    <button
                      onClick={() => setShowAddAgent(false)}
                      className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <SearchCombo
                    options={presetOptions}
                    value={selectedPresetId}
                    onChange={setSelectedPresetId}
                    placeholder="Select a role preset..."
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleAddFromPreset}
                      disabled={!selectedPresetId || addingAgent}
                      className="btn-primary px-4 py-1.5 text-xs flex items-center gap-1.5"
                    >
                      {addingAgent ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      Create & Add
                    </button>
                    <button
                      onClick={() => setShowAddAgent(false)}
                      className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {team.agents.length === 0 ? (
            <div
              className="rounded-2xl p-8 text-center"
              style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
            >
              <Users className="w-8 h-8 mx-auto mb-3 text-[var(--muted-foreground)]" />
              <p className="text-sm text-[var(--muted-foreground)]">No agents in this team yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {team.agents
                .sort((a, b) => a.routing_order - b.routing_order)
                .map((agent) => {
                  const p = participantMap.get(agent.agent_id);
                  const name = p?.name ?? agent.agent_id.slice(0, 8);
                  const color = p?.color ?? "#6B7280";
                  const provider = p?.provider ?? "claude";
                  const model = p?.model ?? null;
                  const skillCount = p?.skills?.length ?? 0;

                  return (
                    <div
                      key={agent.agent_id}
                      className="group rounded-2xl p-4 transition-colors hover:bg-[var(--muted)]/60 cursor-pointer"
                      style={{ background: "var(--card-bg)", border: "1px solid var(--border)" }}
                      onClick={() =>
                        router.push(
                          `/projects/${slug}/teams/${teamId}/agents/${agent.agent_id}`,
                        )
                      }
                    >
                      <div className="flex items-center gap-4">
                        {/* Avatar */}
                        <img
                          src={agentAvatarUrl(agent.agent_id, 40, color)}
                          alt={name}
                          className="w-10 h-10 rounded-xl flex-shrink-0"
                        />

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{name}</span>
                            <span className="text-[10px] font-mono text-[var(--muted-foreground)]">
                              #{agent.routing_order}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {/* Role badge */}
                            {editingRoleAgentId === agent.agent_id ? (
                              <div
                                className="w-36"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <SearchCombo
                                  options={roleOptions}
                                  value={agent.role_key}
                                  onChange={async (roleKey) => {
                                    if (!project) return;
                                    // Remove and re-add with new role
                                    await fetch(
                                      `/api/projects/${project.id}/teams/${teamId}/agents?agentId=${encodeURIComponent(agent.agent_id)}`,
                                      { method: "DELETE" },
                                    );
                                    await fetch(
                                      `/api/projects/${project.id}/teams/${teamId}/agents`,
                                      {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                          agentId: agent.agent_id,
                                          roleKey,
                                          routingOrder: agent.routing_order,
                                        }),
                                      },
                                    );
                                    setEditingRoleAgentId(null);
                                    await fetchTeam();
                                  }}
                                  placeholder="Role..."
                                />
                              </div>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingRoleAgentId(agent.agent_id);
                                }}
                                className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--muted)] text-[var(--muted-foreground)] border border-[var(--border)] hover:border-[var(--primary)] transition-colors"
                                title="Click to change role"
                              >
                                {agent.role_key}
                              </button>
                            )}

                            {/* Provider/model */}
                            <span className="flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
                              <Cpu className="w-3 h-3" />
                              {provider}
                              {model && <span className="font-mono">/ {model}</span>}
                            </span>

                            {/* Skills count */}
                            {skillCount > 0 && (
                              <span className="flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
                                <Zap className="w-3 h-3" />
                                {skillCount}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div
                          className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => setEditAgentId(agent.agent_id)}
                            className="p-1.5 rounded-lg hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                            title="Edit agent"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleRemoveAgent(agent.agent_id)}
                            disabled={removingAgentId === agent.agent_id}
                            className="p-1.5 rounded-lg hover:bg-red-500/15 text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
                            title="Remove from team"
                          >
                            {removingAgentId === agent.agent_id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <X className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>

                        {/* Chevron */}
                        <ChevronRight className="w-4 h-4 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Danger zone */}
        <div className="pt-6 border-t" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
            Danger Zone
          </h2>
          {confirmDelete ? (
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-500/5 border border-red-500/20">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="text-sm text-red-400 flex-1">
                Delete this team? This cannot be undone.
              </span>
              <button
                onClick={handleDeleteTeam}
                disabled={deleting}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Confirm Delete"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] hover:bg-[var(--muted)]/50 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Team
            </button>
          )}
        </div>
      </div>

      {/* Edit agent modal */}
      {editAgentId && participantMap.get(editAgentId) && (
        <AgentForm
          title="Edit agent"
          initial={{
            name: participantMap.get(editAgentId)!.name,
            role: participantMap.get(editAgentId)!.role || "",
            provider: participantMap.get(editAgentId)!.provider,
            model: participantMap.get(editAgentId)!.model || "",
            identity: participantMap.get(editAgentId)!.identity || "",
            color: participantMap.get(editAgentId)!.color,
            skills: participantMap.get(editAgentId)!.skills || [],
            skillBindings: participantMap.get(editAgentId)!.skillBindings || [],
          }}
          agentId={editAgentId}
          submitLabel="Save"
          onSubmit={async (data: AgentFormData) => {
            await fetch("/api/participants", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: editAgentId,
                name: data.name,
                role: data.role || null,
                provider: data.provider,
                model: data.model,
                color: data.color,
                ...(data.identity ? { identity: data.identity } : {}),
                skills: data.skills ?? [],
                skillBindings: data.skillBindings ?? [],
              }),
            });
            setEditAgentId(null);
            await fetchParticipants();
          }}
          onCancel={() => setEditAgentId(null)}
        />
      )}
    </div>
  );
}
