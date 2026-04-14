"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getAgentPresetBindings,
  listAgentPresets,
  listTeamTemplates,
  type AgentPreset,
  type AgentPresetId,
} from "@/lib/team-catalog";
import SearchCombo, { type ComboOption } from "@/components/SearchCombo";
import { useProjectsWithAgents } from "@/hooks/useProjects";
import {
  AgentForm,
  type AgentFormData,
} from "@/components/chat-ui/ParticipantBar";
import type { ChatProvider, SkillBinding } from "@/lib/types";
import { Check, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Users, X } from "lucide-react";

/** Matches lib/cli/providers.js PROVIDERS map. */
const PROVIDERS: { id: string; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "ollama", label: "Ollama" },
  { id: "codex", label: "Codex CLI" },
];

/** Matches lib/cli/onboarding.js model lists per provider. */
const MODEL_SUGGESTIONS: Record<string, string[]> = {
  claude: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
  gemini: ["gemini-3-pro-preview", "gemini-3-flash-preview"],
  ollama: ["glm-5:cloud", "qwen3.5:397b-cloud", "qwen3.5:cloud", "minimax-m2.5:cloud", "kimi-k2.5:cloud"],
  codex: ["gpt-5.3-codex", "gpt-5.1-code-mini"],
};

/** Searchable combobox: text input with dropdown suggestions, allows custom values. */
function ModelCombobox({
  value,
  onChange,
  suggestions,
  placeholder = "Model name...",
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = suggestions.filter((s) =>
    s.toLowerCase().includes((filter || value).toLowerCase())
  );

  return (
    <div ref={wrapperRef} className="relative flex-1">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setFilter(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="w-full h-8 px-2.5 text-xs rounded-lg border bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--foreground)]/40 transition-colors disabled:opacity-50"
        style={{ borderColor: "var(--border)" }}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-[160px] overflow-y-auto rounded-lg border bg-[var(--background)] shadow-lg" style={{ borderColor: "var(--border)" }}>
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                onChange(s);
                setFilter("");
                setOpen(false);
              }}
              className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors hover:bg-[var(--muted)] ${
                s === value ? "text-[var(--foreground)] font-medium" : "text-[var(--muted-foreground)]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Custom dropdown for provider selection. */
function ProviderDropdown({
  value,
  onChange,
  providers,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  providers: { id: string; label: string }[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selected = providers.find((p) => p.id === value);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="h-8 px-2.5 pr-7 text-xs rounded-lg border bg-[var(--background)] text-left transition-colors hover:border-[var(--foreground)]/40 disabled:opacity-50 disabled:cursor-not-allowed min-w-[120px]"
        style={{ borderColor: "var(--border)" }}
      >
        <span className={selected ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}>
          {selected?.label ?? "Provider..."}
        </span>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--muted-foreground)]" />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 min-w-[160px] rounded-lg border bg-[var(--background)] shadow-lg overflow-hidden" style={{ borderColor: "var(--border)" }}>
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onChange(p.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-[var(--muted)] flex items-center justify-between gap-3 ${
                p.id === value ? "text-[var(--foreground)] font-medium" : "text-[var(--muted-foreground)]"
              }`}
            >
              {p.label}
              {p.id === value && <Check className="w-3 h-3 text-[var(--foreground)]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Provider dropdown + model combobox, compact layout. */
function ProviderModelSelector({
  provider,
  model,
  onProviderChange,
  onModelChange,
  label,
  disabled,
}: {
  provider: string;
  model: string;
  onProviderChange: (v: string) => void;
  onModelChange: (v: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const suggestions = MODEL_SUGGESTIONS[provider] ?? [];

  return (
    <div className="space-y-1.5">
      {label && (
        <span className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide">{label}</span>
      )}
      <div className="flex items-center gap-2">
        <ProviderDropdown
          value={provider}
          onChange={(v) => {
            onProviderChange(v);
            onModelChange("");
          }}
          providers={PROVIDERS}
          disabled={disabled}
        />
        <ModelCombobox
          value={model}
          onChange={onModelChange}
          suggestions={suggestions}
          placeholder={provider ? "Select or type model..." : "Select a provider first"}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

const AGENT_COLORS = ["#D97706", "#2563EB", "#059669", "#DC2626", "#7C3AED", "#DB2777", "#0891B2"];

interface DraftAgent extends AgentFormData {
  id: string;
  roleId: AgentPresetId;
}

interface AgentEditorState {
  key: string;
  mode: "create" | "edit";
  draftId: string | null;
  initial: AgentFormData;
}

function toSkillBindings(preset: AgentPreset): SkillBinding[] {
  return getAgentPresetBindings(preset).map((binding) => ({
    repo: binding.repo,
    skillId: binding.skillId,
    ...(binding.condition ? { condition: binding.condition } : {}),
  }));
}

function createAgentDraft(id: string, preset: AgentPreset, color: string, defaultProvider?: ChatProvider, defaultModel?: string): DraftAgent {
  return {
    id,
    roleId: preset.id,
    name: preset.name,
    title: preset.title,
    provider: defaultProvider || "claude",
    model: defaultModel || "",
    identity: preset.identity,
    color,
    skills: [],
    skillBindings: toSkillBindings(preset),
  };
}

function applyPreset(rolePreset: AgentPreset, currentData: AgentFormData): AgentFormData {
  return {
    ...currentData,
    roleId: rolePreset.id,
    name: rolePreset.name,
    title: rolePreset.title,
    identity: rolePreset.identity,
    skills: [],
    skillBindings: toSkillBindings(rolePreset),
  };
}

export default function NewTeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const { projects } = useProjectsWithAgents();
  const project = projects.find((entry) => entry.slug === slug);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [draftAgents, setDraftAgents] = useState<DraftAgent[]>([]);
  const [teamName, setTeamName] = useState("");
  const [teamProvider, setTeamProvider] = useState<ChatProvider | "">("");
  const [teamModel, setTeamModel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentEditor, setAgentEditor] = useState<AgentEditorState | null>(null);


  const templates = useMemo(() => listTeamTemplates(), []);
  const allPresets = useMemo(() => listAgentPresets(), []);
  const nextDraftId = useRef(0);
  const nextEditorId = useRef(0);

  const presetMap = useMemo(
    () => new Map(allPresets.map((preset) => [preset.id, preset])),
    [allPresets],
  );

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  const templateOptions: ComboOption[] = useMemo(
    () => templates.map((template) => ({
      id: template.id,
      label: template.name,
      description: template.description,
      meta: template.variants ? `${template.variants.length} specializations` : `${template.agents.length} agents`,
    })),
    [templates],
  );

  const variantOptions: ComboOption[] = useMemo(() => {
    if (!selectedTemplate?.variants) return [];
    return selectedTemplate.variants.map((variant) => ({
      id: variant.id,
      label: variant.name,
      description: variant.description,
      meta: `${variant.agents.length} agents`,
    }));
  }, [selectedTemplate]);

  const roleOptions: ComboOption[] = useMemo(
    () =>
      allPresets.map((preset) => ({
        id: preset.id,
        label: preset.name,
        description: preset.identity,
        meta: preset.skillProfileId,
      })),
    [allPresets],
  );

  function createDraftId() {
    const id = `draft-agent-${nextDraftId.current}`;
    nextDraftId.current += 1;
    return id;
  }

  function createEditorKey() {
    const id = `agent-editor-${nextEditorId.current}`;
    nextEditorId.current += 1;
    return id;
  }

  function getNextColor(index: number) {
    return AGENT_COLORS[index % AGENT_COLORS.length];
  }

  function seedDraftAgents(presets: AgentPreset[]) {
    setDraftAgents(
      presets.map((preset, index) =>
        createAgentDraft(createDraftId(), preset, getNextColor(index), teamProvider || undefined, teamModel),
      ),
    );
  }

  function getDefaultPreset() {
    return (
      (selectedTemplate?.variants && selectedVariantId
        ? selectedTemplate.variants.find((variant) => variant.id === selectedVariantId)?.agents[0]
        : undefined) ??
      selectedTemplate?.agents[0] ??
      allPresets[0]
    );
  }

  function handleTemplateChange(id: string) {
    setSelectedTemplateId(id);
    setSelectedVariantId(null);
    setError(null);

    const template = templates.find((entry) => entry.id === id);
    if (!template) return;

    setTeamName(template.name);
    if (template.variants?.length) {
      setDraftAgents([]);
      return;
    }

    seedDraftAgents(template.agents);
  }

  function handleVariantChange(id: string) {
    setSelectedVariantId(id);
    setError(null);

    const variant = selectedTemplate?.variants?.find((entry) => entry.id === id);
    if (!variant) return;

    setTeamName(variant.name);
    seedDraftAgents(variant.agents);
  }

  function openAgentEditor(mode: "create" | "edit", draft?: DraftAgent) {
    if (mode === "edit" && draft) {
      setAgentEditor({
        key: createEditorKey(),
        mode,
        draftId: draft.id,
        initial: draft,
      });
      return;
    }

    const preset = getDefaultPreset();
    if (!preset) return;

    setAgentEditor({
      key: createEditorKey(),
      mode,
      draftId: null,
      initial: createAgentDraft(createDraftId(), preset, getNextColor(draftAgents.length), teamProvider || undefined, teamModel),
    });
  }

  function handleSaveAgent(data: AgentFormData) {
    const roleId = data.roleId as AgentPresetId | undefined;
    if (!roleId || !presetMap.has(roleId) || !agentEditor) return;

    const nextAgent: DraftAgent = {
      id: agentEditor.draftId ?? createDraftId(),
      roleId,
      name: data.name.trim(),
      title: data.title?.trim(),
      provider: data.provider,
      model: data.model.trim(),
      identity: data.identity.trim(),
      color: data.color,
      skills: data.skills ?? [],
      skillBindings: data.skillBindings ?? [],
    };

    setDraftAgents((current) => {
      if (agentEditor.mode === "edit" && agentEditor.draftId) {
        return current.map((draft) => (
          draft.id === agentEditor.draftId ? nextAgent : draft
        ));
      }
      return [...current, nextAgent];
    });
    setAgentEditor(null);
  }

  function handleRemoveAgent(id: string) {
    setDraftAgents((current) => current.filter((draft) => draft.id !== id));
  }

  async function handleCreate() {
    if (!teamName.trim() || draftAgents.length === 0 || !project) return;

    setCreating(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        name: teamName.trim(),
        provider: teamProvider || undefined,
        model: teamModel || undefined,
        agents: draftAgents.map((agent) => ({
          roleId: agent.roleId,
          name: agent.name,
          title: agent.title || undefined,
          provider: agent.provider || teamProvider || "claude" as string,
          model: agent.model || teamModel || "",
          identity: agent.identity || undefined,
          color: agent.color,
          skills: agent.skills ?? [],
          skillBindings: agent.skillBindings ?? [],
        })),
      };

      if (selectedTemplateId) body.templateId = selectedTemplateId;
      if (selectedVariantId) body.variantId = selectedVariantId;

      const res = await fetch(`/api/projects/${project.id}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to create team (${res.status})`);
      }

      router.push(`/projects/${slug}/teams`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create team");
      setCreating(false);
    }
  }

  if (!project) {
    return <div className="flex items-center justify-center h-full text-sm text-zinc-500">Loading...</div>;
  }

  const hasVariants = Boolean(selectedTemplate?.variants);
  const isConfigured = draftAgents.length > 0;

  return (
    <>
      <div className="h-full overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
          <div>
            <h1 className="text-lg font-bold">Add Team</h1>
            <p className="text-xs text-[var(--muted-foreground)]">Pick a template, customize agents, and create.</p>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-[var(--destructive-muted)] border border-[var(--destructive)]/20 text-sm text-[var(--destructive)]">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Team name</label>
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Core Engineering"
              className="input w-full text-sm"
              disabled={creating}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Template</label>
            <SearchCombo
              options={templateOptions}
              value={selectedTemplateId}
              onChange={handleTemplateChange}
              placeholder="Select a team template..."
              disabled={creating}
            />
          </div>

          {hasVariants && (
            <div>
              <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Specialization</label>
              <SearchCombo
                options={variantOptions}
                value={selectedVariantId}
                onChange={handleVariantChange}
                placeholder="Select a specialization..."
                disabled={creating}
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Default provider & model</label>
            <ProviderModelSelector
              provider={teamProvider}
              model={teamModel}
              onProviderChange={(v) => setTeamProvider((v || "") as ChatProvider | "")}
              onModelChange={setTeamModel}
              disabled={creating}
            />
            <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
              Applies to all agents unless individually overridden.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <label className="block text-xs font-medium text-[var(--muted-foreground)]">
                Agents ({draftAgents.length})
              </label>
              <button
                type="button"
                onClick={() => openAgentEditor("create")}
                disabled={creating}
                className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--muted)]/50 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ borderColor: "var(--border)" }}
              >
                <Plus className="w-3.5 h-3.5" />
                Add Agent
              </button>
            </div>

            {isConfigured ? (
              <div className="space-y-2">
                {draftAgents.map((agent) => {
                  const preset = presetMap.get(agent.roleId);
                  return (
                    <div
                      key={agent.id}
                      className="flex items-start justify-between gap-3 rounded-xl px-3 py-3"
                      style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="mt-0.5 w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 bg-emerald-500/15">
                          <Check className="w-3 h-3 text-emerald-400" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{agent.name}</div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            {preset && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-full"
                                style={{ background: "var(--card-bg)", color: "var(--muted-foreground)" }}
                              >
                                {preset.name}
                              </span>
                            )}
                            {agent.title && (
                              <span className="text-xs text-[var(--muted-foreground)] truncate">
                                {agent.title}
                              </span>
                            )}
                            {agent.model && agent.model !== teamModel && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-violet-500/15 text-violet-400">
                                custom
                              </span>
                            )}
                            {(agent.model || teamModel) && (
                              <span className="text-[10px] text-[var(--muted-foreground)]">
                                {agent.model || teamModel}
                              </span>
                            )}
                            {(agent.skillBindings?.length ?? 0) > 0 && (
                              <span className="text-[10px] text-[var(--muted-foreground)]">
                                {agent.skillBindings?.length} skills
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openAgentEditor("edit", agent)}
                          disabled={creating}
                          className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--card-bg)] transition-colors"
                          title={`Edit ${agent.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveAgent(agent.id)}
                          disabled={creating}
                          className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-red-400 hover:bg-red-500/15 transition-colors"
                          title={`Remove ${agent.name}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className="rounded-xl px-4 py-5 text-sm text-[var(--muted-foreground)]"
                style={{ background: "var(--muted)", border: "1px dashed var(--border)" }}
              >
                Add your first agent using the full agent form, then assign its role from a preset.
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
            <button
              onClick={() => router.push(`/projects/${slug}/teams`)}
              disabled={creating}
              className="px-4 py-2 rounded-xl border hover:bg-[var(--muted)]/50 transition-colors text-sm"
              style={{ borderColor: "var(--border)" }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!teamName.trim() || !isConfigured || creating}
              className="btn-primary px-5 py-2 text-sm min-w-[120px] flex items-center justify-center gap-2"
            >
              {creating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Users className="w-4 h-4" />
                  Create Team ({draftAgents.length})
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {agentEditor && (
        <AgentForm
          key={agentEditor.key}
          title={agentEditor.mode === "edit" ? "Edit agent" : "Add agent"}
          initial={agentEditor.initial}
          submitLabel={agentEditor.mode === "edit" ? "Save" : "Add"}
          onSubmit={(data) => handleSaveAgent(data)}
          onCancel={() => setAgentEditor(null)}
          roleOptions={roleOptions}
          onRolePresetChange={(roleId, currentData) => {
            const preset = presetMap.get(roleId as AgentPresetId);
            if (!preset) return currentData;
            return applyPreset(preset, currentData);
          }}
        />
      )}
    </>
  );
}
