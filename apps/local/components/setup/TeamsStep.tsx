// components/setup/TeamsStep.tsx
"use client";

import { useState, useCallback } from "react";
import { Check, ChevronDown, Users, X } from "lucide-react";
import { listTeamTemplates, getTemplateVariant, type TeamTemplate, type TeamTemplateVariant, type TeamTemplateId, type AgentPreset } from "@/lib/team-catalog";
import { SetupLayout } from "./SetupLayout";

export interface SelectedTeam {
  templateId: TeamTemplateId;
  variantId?: string;
  name: string;
  agents: AgentPreset[];
}

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

function AgentPreview({ agent }: { agent: AgentPreset }) {
  const styleClass = STYLE_COLORS[agent.style] ?? STYLE_COLORS.balanced;
  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="w-7 h-7 rounded-full bg-[var(--secondary)] flex items-center justify-center text-[12px] font-semibold text-[var(--foreground)]">
        {agent.name.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-[var(--foreground)]">{agent.name}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${styleClass}`}>{agent.style}</span>
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)] truncate">{agent.title}</p>
      </div>
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
              <div className="pl-6 space-y-0.5">
                {team.agents.map((agent) => <AgentPreview key={agent.id} agent={agent} />)}
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
