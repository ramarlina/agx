"use client";

import { useState, useMemo } from "react";
import {
  listTeamTemplates,
  getSkillProfileBindings,
  type TeamTemplate,
  type AgentPreset,
  type SkillProfileId,
} from "@/lib/team-catalog";
import { Users, Loader2, Check, AlertCircle, ChevronDown } from "lucide-react";

interface UnassignedAgent {
  id: string;
  name: string;
  style: string;
  skills: Array<{ file: string }>;
}

interface AgentRoleMatch {
  agent: UnassignedAgent;
  matchedPreset: AgentPreset | null;
  overlap: string[]; // skill files the agent has that the preset expects
  missing: string[]; // skill files the preset expects but the agent lacks
  manualRoleKey: string | null; // user override
}

interface AdoptAgentsModalProps {
  projectId: string;
  unassignedAgents: UnassignedAgent[];
  onClose: () => void;
  onAdopted: () => void;
}

function computeSkillOverlap(
  agentSkillFiles: string[],
  profileId: SkillProfileId
): { overlap: string[]; missing: string[] } {
  const bindings = getSkillProfileBindings(profileId);
  const expectedFiles = bindings.map((b) => `${b.repo}/${b.skillId}`);
  const agentSet = new Set(agentSkillFiles);
  const overlap = expectedFiles.filter((f) => agentSet.has(f));
  const missing = expectedFiles.filter((f) => !agentSet.has(f));
  return { overlap, missing };
}

function bestMatch(
  agent: UnassignedAgent,
  presets: AgentPreset[]
): { preset: AgentPreset | null; overlap: string[]; missing: string[] } {
  const agentFiles = agent.skills.map((s) => s.file);
  let best: { preset: AgentPreset | null; overlap: string[]; missing: string[] } = {
    preset: null,
    overlap: [],
    missing: [],
  };
  let bestScore = -1;

  for (const preset of presets) {
    const { overlap, missing } = computeSkillOverlap(agentFiles, preset.skillProfileId);
    if (overlap.length > bestScore) {
      bestScore = overlap.length;
      best = { preset, overlap, missing };
    }
  }

  return best;
}

export default function AdoptAgentsModal({
  projectId,
  unassignedAgents,
  onClose,
  onAdopted,
}: AdoptAgentsModalProps) {
  const [teamName, setTeamName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [backfillSkills, setBackfillSkills] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualRoles, setManualRoles] = useState<Record<string, string | null>>({});

  const templates = useMemo(() => listTeamTemplates(), []);
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId]
  );

  const matches: AgentRoleMatch[] = useMemo(() => {
    if (!selectedTemplate) {
      return unassignedAgents.map((agent) => ({
        agent,
        matchedPreset: null,
        overlap: [],
        missing: [],
        manualRoleKey: manualRoles[agent.id] ?? null,
      }));
    }

    return unassignedAgents.map((agent) => {
      const manualKey = manualRoles[agent.id];
      if (manualKey) {
        const preset = selectedTemplate.agents.find((a) => a.roleKey === manualKey) ?? null;
        if (preset) {
          const agentFiles = agent.skills.map((s) => s.file);
          const { overlap, missing } = computeSkillOverlap(agentFiles, preset.skillProfileId);
          return { agent, matchedPreset: preset, overlap, missing, manualRoleKey: manualKey };
        }
      }

      const { preset, overlap, missing } = bestMatch(agent, selectedTemplate.agents);
      return { agent, matchedPreset: preset, overlap, missing, manualRoleKey: null };
    });
  }, [unassignedAgents, selectedTemplate, manualRoles]);

  function setManualRole(agentId: string, roleKey: string | null) {
    setManualRoles((prev) => ({ ...prev, [agentId]: roleKey }));
  }

  async function handleCreate() {
    const name = teamName.trim();
    if (!name) return;

    setCreating(true);
    setError(null);

    try {
      // 1. Create the team
      const body: Record<string, string> = { name };
      if (selectedTemplateId) body.templateId = "__custom__";

      const teamRes = await fetch(`/api/projects/${projectId}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!teamRes.ok) {
        const data = await teamRes.json().catch(() => ({}));
        throw new Error(data.error || `Failed to create team (${teamRes.status})`);
      }

      const { team } = await teamRes.json();

      // 2. Add each agent to the team
      for (const match of matches) {
        const roleKey =
          match.manualRoleKey ??
          match.matchedPreset?.roleKey ??
          "member";

        await fetch(`/api/projects/${projectId}/teams/${team.id}/agents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: match.agent.id, roleKey }),
        });
      }

      // 3. Backfill missing skills if requested
      if (backfillSkills && selectedTemplate) {
        for (const match of matches) {
          if (match.missing.length > 0 && match.matchedPreset) {
            const bindings = getSkillProfileBindings(match.matchedPreset.skillProfileId);
            const missingSet = new Set(match.missing);
            const skillsToAdd = bindings
              .filter((b) => missingSet.has(`${b.repo}/${b.skillId}`))
              .map((b) => ({
                file: `${b.repo}/${b.skillId}`,
                ...(b.condition ? { condition: b.condition } : {}),
              }));

            if (skillsToAdd.length > 0) {
              const existingSkills = match.agent.skills.map((s) => ({ file: s.file }));
              const merged = [...existingSkills, ...skillsToAdd];

              await fetch(`/api/agents/${match.agent.id}/skills`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ skills: merged }),
              });
            }
          }
        }
      }

      onAdopted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to adopt agents");
      setCreating(false);
    }
  }

  return (
    <div
      className="modal-backdrop p-2 sm:p-4 z-50 overflow-y-auto flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-content w-full max-w-3xl mx-2 sm:mx-auto bg-[var(--card-bg)] rounded-3xl border border-[var(--card-border)] shadow-2xl animate-scale-in flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-4 py-4 sm:px-8 sm:py-6 border-b border-[var(--card-border)] flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold">Adopt Unassigned Agents</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Group {unassignedAgents.length} unassigned agent
              {unassignedAgents.length !== 1 ? "s" : ""} into a team.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-[var(--muted)]/50 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6">
          {error && (
            <div className="p-4 rounded-xl bg-[var(--destructive-muted)] border border-[var(--destructive)]/20 text-sm text-[var(--destructive)]">
              {error}
            </div>
          )}

          {/* Team name */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Team Name</label>
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Core Engineering"
              className="input w-full text-sm"
              disabled={creating}
              autoFocus
            />
          </div>

          {/* Template selector */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Template <span className="text-[var(--muted-foreground)] font-normal">(optional)</span>
            </label>
            <div className="relative">
              <select
                value={selectedTemplateId ?? ""}
                onChange={(e) => setSelectedTemplateId(e.target.value || null)}
                disabled={creating}
                className="appearance-none w-full bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl text-sm pl-3 pr-8 py-2 cursor-pointer focus:border-[var(--primary)] focus:outline-none transition-colors"
              >
                <option value="">None</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--muted-foreground)]" />
            </div>
          </div>

          {/* Agent-role matching table */}
          {selectedTemplate && (
            <div>
              <label className="block text-sm font-medium mb-2">Role Matching</label>
              <div className="space-y-2">
                {matches.map((match) => (
                  <div
                    key={match.agent.id}
                    className="p-3 rounded-2xl border border-[var(--card-border)] bg-[var(--muted)]/10"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Users className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
                        <span className="text-sm font-medium truncate">
                          {match.agent.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {match.matchedPreset ? (
                          <span className="text-xs font-medium text-[var(--primary)] bg-[var(--primary)]/10 px-2 py-0.5 rounded-lg">
                            {match.matchedPreset.name}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--muted-foreground)]">No match</span>
                        )}
                        {/* Role picker dropdown */}
                        <div className="relative">
                          <select
                            value={
                              match.manualRoleKey ??
                              match.matchedPreset?.roleKey ??
                              ""
                            }
                            onChange={(e) =>
                              setManualRole(
                                match.agent.id,
                                e.target.value || null
                              )
                            }
                            disabled={creating}
                            className="appearance-none bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg text-xs pl-2 pr-6 py-1 cursor-pointer"
                          >
                            <option value="">Auto</option>
                            {selectedTemplate.agents.map((preset) => (
                              <option key={preset.roleKey} value={preset.roleKey}>
                                {preset.name}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--muted-foreground)]" />
                        </div>
                      </div>
                    </div>

                    {/* Skill overlap details */}
                    {match.matchedPreset && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {match.overlap.map((file) => (
                          <span
                            key={file}
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          >
                            <Check className="w-2.5 h-2.5" />
                            {file.split("/").pop()}
                          </span>
                        ))}
                        {match.missing.map((file) => (
                          <span
                            key={file}
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          >
                            <AlertCircle className="w-2.5 h-2.5" />
                            {file.split("/").pop()}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Backfill checkbox */}
          {selectedTemplate && matches.some((m) => m.missing.length > 0) && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={backfillSkills}
                onChange={(e) => setBackfillSkills(e.target.checked)}
                disabled={creating}
                className="rounded border-[var(--card-border)]"
              />
              <span className="text-sm">Add missing skills from template</span>
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-4 sm:px-8 sm:py-6 border-t border-[var(--card-border)] flex items-center justify-end gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={creating}
            className="px-4 py-2 rounded-xl border border-[var(--card-border)] hover:bg-[var(--muted)]/50 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!teamName.trim() || creating}
            className="btn-primary px-5 py-2 text-sm min-w-[120px] flex items-center justify-center gap-2"
          >
            {creating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Users className="w-4 h-4" />
                Create Team
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
