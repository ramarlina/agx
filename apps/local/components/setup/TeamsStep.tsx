// components/setup/TeamsStep.tsx
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Check, ChevronDown, ChevronRight, Users, X } from "lucide-react";
import { listTeamTemplates, getTemplateVariant, type TeamTemplate, type TeamTemplateVariant, type TeamTemplateId, type AgentPreset } from "@/lib/team-catalog";
import { useProviders } from "@/hooks/useProviders";
import { SetupLayout } from "./SetupLayout";

export interface AgentOverride {
  agentId: string;
  provider?: string;
  model?: string;
}

export interface SelectedTeam {
  templateId: TeamTemplateId;
  variantId?: string;
  name: string;
  agents: AgentPreset[];
  provider?: string;
  model?: string;
  agentOverrides?: AgentOverride[];
}

/** Well-known models per provider for the combobox suggestions. */
const MODEL_SUGGESTIONS: Record<string, string[]> = {
  claude: [
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-haiku-4-20250514",
  ],
  codex: [
    "o4-mini",
    "o3",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
  ],
  gemini: [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
  ],
  ollama: [
    "qwen3:8b",
    "devstral",
    "qwen2.5-coder:14b",
    "llama3.3:70b",
    "deepseek-coder-v2:16b",
  ],
  zai: [
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
  ],
};

interface TeamsStepProps {
  selectedTeams: SelectedTeam[];
  onChange: (teams: SelectedTeam[]) => void;
  onNext: () => void;
  onBack: () => void;
}

const STYLE_COLORS: Record<string, string> = {
  balanced: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
  specialist: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
  creative: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
  analytical: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
};

/** Searchable combobox: text input with dropdown suggestions, allows custom values. */
function ModelCombobox({
  value,
  onChange,
  suggestions,
  placeholder = "Model name...",
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
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
        onChange={(e) => {
          onChange(e.target.value);
          setFilter(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="w-full h-8 px-2.5 text-[12px] rounded-md border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--foreground)]/40 transition-colors"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-[160px] overflow-y-auto rounded-md border border-[var(--card-border)] bg-[var(--background)] shadow-lg">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                onChange(s);
                setFilter("");
                setOpen(false);
              }}
              className={`w-full text-left px-2.5 py-1.5 text-[12px] transition-colors hover:bg-[var(--secondary)] ${
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

/** Provider dropdown + model combobox, compact layout. */
function ProviderModelSelector({
  provider,
  model,
  onProviderChange,
  onModelChange,
  providers,
  label,
}: {
  provider: string;
  model: string;
  onProviderChange: (v: string) => void;
  onModelChange: (v: string) => void;
  providers: { id: string; label: string }[];
  label?: string;
}) {
  const suggestions = MODEL_SUGGESTIONS[provider] ?? [];

  return (
    <div className="space-y-1.5">
      {label && (
        <span className="text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide">{label}</span>
      )}
      <div className="flex items-center gap-2">
        <select
          value={provider}
          onChange={(e) => {
            onProviderChange(e.target.value);
            // Clear model when provider changes
            onModelChange("");
          }}
          className="h-8 px-2 text-[12px] rounded-md border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:border-[var(--foreground)]/40 transition-colors appearance-none cursor-pointer pr-6"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" }}
        >
          <option value="">Provider...</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <ModelCombobox
          value={model}
          onChange={onModelChange}
          suggestions={suggestions}
          placeholder={provider ? "Select or type model..." : "Select a provider first"}
        />
      </div>
    </div>
  );
}

function AgentPreview({
  agent,
  override,
  teamProvider,
  teamModel,
  providers,
  onOverrideChange,
}: {
  agent: AgentPreset;
  override?: AgentOverride;
  teamProvider?: string;
  teamModel?: string;
  providers: { id: string; label: string }[];
  onOverrideChange: (agentId: string, override: AgentOverride | undefined) => void;
}) {
  const styleClass = STYLE_COLORS[agent.style] ?? STYLE_COLORS.balanced;
  const hasOverride = override && (override.provider || override.model);
  const [showOverride, setShowOverride] = useState(!!hasOverride);
  const effectiveProvider = override?.provider || teamProvider || "";
  const effectiveModel = override?.model || teamModel || "";

  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-[var(--secondary)] flex items-center justify-center text-[12px] font-semibold text-[var(--foreground)]">
          {agent.name.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-[var(--foreground)]">{agent.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${styleClass}`}>{agent.style}</span>
            {hasOverride && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">custom</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <p className="text-[11px] text-[var(--muted-foreground)] truncate">{agent.title}</p>
            {(teamProvider || teamModel) && !hasOverride && effectiveModel && (
              <span className="text-[10px] text-[var(--muted-foreground)] opacity-60 shrink-0">
                ({effectiveModel})
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (showOverride) {
              onOverrideChange(agent.id, undefined);
              setShowOverride(false);
            } else {
              setShowOverride(true);
            }
          }}
          className="p-1 rounded hover:bg-[var(--background)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          title={showOverride ? "Remove override" : "Override provider/model"}
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${showOverride ? "rotate-90" : ""}`} />
        </button>
      </div>
      {showOverride && (
        <div className="mt-1.5 ml-9">
          <ProviderModelSelector
            provider={override?.provider || ""}
            model={override?.model || ""}
            onProviderChange={(p) => onOverrideChange(agent.id, { agentId: agent.id, provider: p || undefined, model: override?.model })}
            onModelChange={(m) => onOverrideChange(agent.id, { agentId: agent.id, provider: override?.provider, model: m || undefined })}
            providers={providers}
          />
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  isSelected,
  onSelect,
}: {
  template: TeamTemplate;
  isSelected: boolean;
  onSelect: (template: TeamTemplate) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      className={`w-full text-left p-4 rounded-lg border transition-all ${
        isSelected
          ? "border-[var(--foreground)] bg-[var(--secondary)]"
          : "border-[var(--card-border)] hover:border-[var(--foreground)]/30 hover:bg-[var(--secondary)]/50"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{template.icon}</span>
          <span className="text-[14px] font-semibold text-[var(--foreground)]">{template.name}</span>
        </div>
        {isSelected && (
          <div className="w-5 h-5 rounded-full bg-[var(--foreground)] flex items-center justify-center">
            <Check className="w-3 h-3 text-[var(--background)]" />
          </div>
        )}
      </div>
      <p className="mt-1 text-[12px] text-[var(--muted-foreground)]">{template.description}</p>
      <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
        {template.agents.length} agent{template.agents.length !== 1 ? "s" : ""}
        {template.variants && template.variants.length > 0 ? ` · ${template.variants.length} variants` : ""}
      </p>
    </button>
  );
}

export function TeamsStep({ selectedTeams, onChange, onNext, onBack }: TeamsStepProps) {
  const templates = listTeamTemplates();
  const { providers } = useProviders();
  const [expandedTemplate, setExpandedTemplate] = useState<TeamTemplateId | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<Record<string, string>>({});

  const isTemplateSelected = useCallback(
    (id: TeamTemplateId) => selectedTeams.some((t) => t.templateId === id),
    [selectedTeams]
  );

  const handleSelectTemplate = useCallback(
    (template: TeamTemplate) => {
      if (isTemplateSelected(template.id)) {
        onChange(selectedTeams.filter((t) => t.templateId !== template.id));
        setExpandedTemplate(null);
        return;
      }

      if (template.variants && template.variants.length > 0) {
        setExpandedTemplate(expandedTemplate === template.id ? null : template.id);
        return;
      }

      onChange([...selectedTeams, {
        templateId: template.id,
        name: template.name,
        agents: template.agents,
      }]);
    },
    [selectedTeams, onChange, expandedTemplate, isTemplateSelected]
  );

  const handleSelectVariant = useCallback(
    (templateId: TeamTemplateId, variant: TeamTemplateVariant) => {
      setSelectedVariant((prev) => ({ ...prev, [templateId]: variant.id }));
      const existing = selectedTeams.filter((t) => t.templateId !== templateId);
      onChange([...existing, {
        templateId,
        variantId: variant.id,
        name: variant.name,
        agents: variant.agents,
      }]);
      setExpandedTemplate(null);
    },
    [selectedTeams, onChange]
  );

  const handleRemoveTeam = useCallback(
    (templateId: TeamTemplateId) => {
      onChange(selectedTeams.filter((t) => t.templateId !== templateId));
    },
    [selectedTeams, onChange]
  );

  const handleTeamProviderChange = useCallback(
    (templateId: TeamTemplateId, provider: string) => {
      onChange(selectedTeams.map((t) =>
        t.templateId === templateId ? { ...t, provider: provider || undefined } : t
      ));
    },
    [selectedTeams, onChange]
  );

  const handleTeamModelChange = useCallback(
    (templateId: TeamTemplateId, model: string) => {
      onChange(selectedTeams.map((t) =>
        t.templateId === templateId ? { ...t, model: model || undefined } : t
      ));
    },
    [selectedTeams, onChange]
  );

  const handleAgentOverrideChange = useCallback(
    (templateId: TeamTemplateId, agentId: string, override: AgentOverride | undefined) => {
      onChange(selectedTeams.map((t) => {
        if (t.templateId !== templateId) return t;
        const overrides = (t.agentOverrides ?? []).filter((o) => o.agentId !== agentId);
        if (override && (override.provider || override.model)) {
          overrides.push(override);
        }
        return { ...t, agentOverrides: overrides.length > 0 ? overrides : undefined };
      }));
    },
    [selectedTeams, onChange]
  );

  return (
    <SetupLayout
      currentStep={4}
      totalSteps={4}
      footer={
        <div className="flex items-center justify-between">
          <button type="button" onClick={onBack} className="text-[14px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            Back
          </button>
          <button
            type="button"
            onClick={onNext}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-[var(--foreground)] text-[var(--background)] text-[14px] font-semibold rounded-lg hover:opacity-90 transition-all"
          >
            {selectedTeams.length > 0 ? "Create Project" : "Skip & Create Project"}
          </button>
        </div>
      }
    >
      <div className="text-center mb-8">
        <h1 className="text-[24px] font-bold text-[var(--foreground)] tracking-tight">Add Teams</h1>
        <p className="mt-2 text-[14px] text-[var(--muted-foreground)]">
          Pick team templates to populate your project with agents. You can customize them later.
        </p>
      </div>

      {/* Selected teams summary */}
      {selectedTeams.length > 0 && (
        <div className="mb-6 space-y-2">
          {selectedTeams.map((team) => (
            <div key={team.templateId} className="border border-[var(--foreground)]/20 bg-[var(--secondary)] rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[var(--muted-foreground)]" />
                  <span className="text-[13px] font-semibold text-[var(--foreground)]">{team.name}</span>
                  <span className="text-[11px] text-[var(--muted-foreground)]">{team.agents.length} agents</span>
                </div>
                <button type="button" onClick={() => handleRemoveTeam(team.templateId)} className="p-1 rounded hover:bg-[var(--background)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Team-level provider/model selector */}
              <div className="pl-6 mb-2">
                <ProviderModelSelector
                  provider={team.provider || ""}
                  model={team.model || ""}
                  onProviderChange={(p) => handleTeamProviderChange(team.templateId, p)}
                  onModelChange={(m) => handleTeamModelChange(team.templateId, m)}
                  providers={providers}
                  label="Default provider & model"
                />
              </div>

              <div className="pl-6 space-y-0.5">
                {team.agents.map((agent) => (
                  <AgentPreview
                    key={agent.id}
                    agent={agent}
                    override={team.agentOverrides?.find((o) => o.agentId === agent.id)}
                    teamProvider={team.provider}
                    teamModel={team.model}
                    providers={providers}
                    onOverrideChange={(agentId, override) => handleAgentOverrideChange(team.templateId, agentId, override)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Template catalog grid */}
      <div className="grid grid-cols-2 gap-3">
        {templates.map((template) => (
          <div key={template.id}>
            <TemplateCard
              template={template}
              isSelected={isTemplateSelected(template.id)}
              onSelect={handleSelectTemplate}
            />

            {/* Variant selector */}
            {expandedTemplate === template.id && template.variants && template.variants.length > 0 && (
              <div className="mt-2 ml-2 border-l-2 border-[var(--border)] pl-3 space-y-1">
                {template.variants.map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => handleSelectVariant(template.id, variant)}
                    className={`w-full text-left px-3 py-2 rounded-md text-[13px] transition-colors ${
                      selectedVariant[template.id] === variant.id
                        ? "bg-[var(--secondary)] font-medium text-[var(--foreground)]"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/50 hover:text-[var(--foreground)]"
                    }`}
                  >
                    {variant.name}
                    <span className="ml-2 text-[11px] text-[var(--muted-foreground)]">
                      {variant.agents.length} agents
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </SetupLayout>
  );
}
