"use client";

import { use, useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  listTeamTemplates,
  listAgentPresets,
  getAgentPresetBindings,
  type AgentPreset,
  type AgentPresetId,
} from "@/lib/team-catalog";
import SearchCombo, { type ComboOption } from "@/components/SearchCombo";
import { useProjectsWithAgents } from "@/hooks/useProjects";
import { Users, Loader2, Check, AlertCircle, X } from "lucide-react";

interface UnassignedAgent {
  id: string;
  name: string;
  style: string;
  skills: Array<{ file: string }>;
}

function computeSkillOverlap(agentSkillFiles: string[], preset: AgentPreset) {
  const bindings = getAgentPresetBindings(preset);
  const expectedFiles = bindings.map((b) => `${b.repo}/${b.skillId}`);
  const agentSet = new Set(agentSkillFiles);
  return {
    overlap: expectedFiles.filter((f) => agentSet.has(f)),
    missing: expectedFiles.filter((f) => !agentSet.has(f)),
  };
}

function bestMatch(agent: UnassignedAgent, presets: AgentPreset[]) {
  const agentFiles = agent.skills.map((s) => s.file);
  let best: { preset: AgentPreset | null; overlap: string[]; missing: string[] } = { preset: null, overlap: [], missing: [] };
  let bestScore = -1;
  for (const preset of presets) {
    const { overlap, missing } = computeSkillOverlap(agentFiles, preset);
    if (overlap.length > bestScore) {
      bestScore = overlap.length;
      best = { preset, overlap, missing };
    }
  }
  return best;
}

export default function AdoptTeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const { projects } = useProjectsWithAgents();
  const project = projects.find((p) => p.slug === slug);

  const [unassignedAgents, setUnassignedAgents] = useState<UnassignedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamName, setTeamName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [backfillSkills, setBackfillSkills] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualPresets, setManualPresets] = useState<Record<string, string | null>>({});

  const templates = useMemo(() => listTeamTemplates(), []);
  const allPresets = useMemo(() => listAgentPresets(), []);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  const selectedVariant = useMemo(() => {
    if (!selectedTemplate?.variants || !selectedVariantId) return null;
    return selectedTemplate.variants.find((v) => v.id === selectedVariantId) ?? null;
  }, [selectedTemplate, selectedVariantId]);

  const templatePresets = useMemo(() => {
    if (selectedVariant) return selectedVariant.agents;
    if (selectedTemplate) return selectedTemplate.agents;
    return [];
  }, [selectedTemplate, selectedVariant]);

  const fetchUnassigned = useCallback(async () => {
    if (!project) return;
    try {
      const res = await fetch(`/api/projects/${project.id}/agents/unassigned`);
      if (res.ok) {
        const data = await res.json();
        setUnassignedAgents(data.agents ?? []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [project]);

  useEffect(() => { fetchUnassigned(); }, [fetchUnassigned]);

  const templateOptions: ComboOption[] = useMemo(
    () => templates.map((t) => ({
      id: t.id,
      label: t.name,
      description: t.description,
      meta: t.variants ? `${t.variants.length} specializations` : `${t.agents.length} roles`,
    })),
    [templates],
  );

  const variantOptions: ComboOption[] = useMemo(() => {
    if (!selectedTemplate?.variants) return [];
    return selectedTemplate.variants.map((v) => ({
      id: v.id,
      label: v.name,
      description: v.description,
      meta: `${v.agents.length} roles`,
    }));
  }, [selectedTemplate]);

  const roleOptions: ComboOption[] = useMemo(() => {
    const presets = templatePresets.length > 0 ? templatePresets : allPresets;
    return [
      { id: "__auto__", label: "Auto", description: "Best match based on skills" },
      ...presets.map((p) => ({ id: p.id, label: p.name, meta: p.skillProfileId })),
    ];
  }, [templatePresets, allPresets]);

  const matches = useMemo(() => {
    if (templatePresets.length === 0) {
      return unassignedAgents.map((agent) => ({ agent, matchedPreset: null as AgentPreset | null, overlap: [] as string[], missing: [] as string[] }));
    }
    return unassignedAgents.map((agent) => {
      const manualKey = manualPresets[agent.id];
      if (manualKey && manualKey !== "__auto__") {
        const preset = templatePresets.find((a) => a.id === manualKey) ?? allPresets.find((a) => a.id === manualKey) ?? null;
        if (preset) {
          const { overlap, missing } = computeSkillOverlap(agent.skills.map((s) => s.file), preset);
          return { agent, matchedPreset: preset, overlap, missing };
        }
      }
      const { preset, overlap, missing } = bestMatch(agent, templatePresets);
      return { agent, matchedPreset: preset, overlap, missing };
    });
  }, [unassignedAgents, templatePresets, manualPresets, allPresets]);

  function handleTemplateChange(id: string) {
    setSelectedTemplateId(id);
    setSelectedVariantId(null);
    setManualPresets({});
    const t = templates.find((t) => t.id === id);
    if (t && !teamName) setTeamName(t.name);
  }

  function handleVariantChange(id: string) {
    setSelectedVariantId(id);
    setManualPresets({});
  }

  async function handleCreate() {
    if (!teamName.trim() || !project) return;
    setCreating(true);
    setError(null);

    try {
      const teamRes = await fetch(`/api/projects/${project.id}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: teamName.trim() }),
      });
      if (!teamRes.ok) throw new Error((await teamRes.json().catch(() => ({}))).error || "Failed to create team");
      const { team } = await teamRes.json();

      for (const match of matches) {
        const role = match.matchedPreset?.id ?? "member";
        await fetch(`/api/projects/${project.id}/teams/${team.id}/agents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: match.agent.id, roleKey: role }),
        });
      }

      if (backfillSkills) {
        for (const match of matches) {
          if (match.missing.length > 0 && match.matchedPreset) {
            const bindings = getAgentPresetBindings(match.matchedPreset);
            const missingSet = new Set(match.missing);
            const skillsToAdd = bindings
              .filter((b) => missingSet.has(`${b.repo}/${b.skillId}`))
              .map((b) => ({ file: `${b.repo}/${b.skillId}`, ...(b.condition ? { condition: b.condition } : {}) }));
            if (skillsToAdd.length > 0) {
              await fetch(`/api/agents/${match.agent.id}/skills`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ skills: [...match.agent.skills.map((s) => ({ file: s.file })), ...skillsToAdd] }),
              });
            }
          }
        }
      }

      router.push(`/projects/${slug}/teams`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to adopt agents");
      setCreating(false);
    }
  }

  if (!project || loading) {
    return <div className="flex items-center justify-center h-full text-sm text-zinc-500">Loading...</div>;
  }

  const hasVariants = !!selectedTemplate?.variants;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-lg font-bold">Adopt Unassigned Agents</h1>
          <p className="text-xs text-[var(--muted-foreground)]">
            Group {unassignedAgents.length} unassigned agent{unassignedAgents.length !== 1 ? "s" : ""} into a team.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-[var(--destructive-muted)] border border-[var(--destructive)]/20 text-sm text-[var(--destructive)]">{error}</div>
        )}

        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Team name</label>
          <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. Core Engineering" className="input w-full text-sm" disabled={creating} autoFocus />
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Template (optional — for role matching)</label>
          <SearchCombo options={templateOptions} value={selectedTemplateId} onChange={handleTemplateChange} placeholder="Select a template..." disabled={creating} />
        </div>

        {hasVariants && (
          <div>
            <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Specialization</label>
            <SearchCombo options={variantOptions} value={selectedVariantId} onChange={handleVariantChange} placeholder="Select a specialization..." disabled={creating} />
          </div>
        )}

        {templatePresets.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">Role matching</label>
            <div className="space-y-1.5">
              {matches.map((match) => (
                <div key={match.agent.id} className="p-2.5 rounded-xl" style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Users className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{match.agent.name}</span>
                    </div>
                    <div className="flex-shrink-0 w-48">
                      <SearchCombo
                        options={roleOptions}
                        value={manualPresets[match.agent.id] ?? match.matchedPreset?.id ?? "__auto__"}
                        onChange={(id) => setManualPresets((prev) => ({ ...prev, [match.agent.id]: id === "__auto__" ? null : id }))}
                        placeholder="Select role..."
                        disabled={creating}
                      />
                    </div>
                  </div>
                  {match.matchedPreset && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {match.overlap.map((f) => (
                        <span key={f} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <Check className="w-2.5 h-2.5" />{f.split("/").pop()}
                        </span>
                      ))}
                      {match.missing.map((f) => (
                        <span key={f} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          <AlertCircle className="w-2.5 h-2.5" />{f.split("/").pop()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {matches.some((m) => m.missing.length > 0) && (
          <label className="flex items-center gap-2.5 cursor-pointer py-1">
            <input type="checkbox" checked={backfillSkills} onChange={(e) => setBackfillSkills(e.target.checked)} disabled={creating} className="rounded" style={{ borderColor: "var(--border)" }} />
            <span className="text-sm">Add missing skills from template</span>
          </label>
        )}

        <div className="flex items-center gap-3 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
          <button onClick={() => router.push(`/projects/${slug}/teams`)} disabled={creating} className="px-4 py-2 rounded-xl border hover:bg-[var(--muted)]/50 transition-colors text-sm" style={{ borderColor: "var(--border)" }}>Cancel</button>
          <button onClick={handleCreate} disabled={!teamName.trim() || creating} className="btn-primary px-5 py-2 text-sm min-w-[120px] flex items-center justify-center gap-2">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Users className="w-4 h-4" />Adopt ({unassignedAgents.length})</>}
          </button>
        </div>
      </div>
    </div>
  );
}
