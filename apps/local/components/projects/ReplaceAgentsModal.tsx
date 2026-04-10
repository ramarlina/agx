"use client";

import { useState, useMemo } from "react";
import { listTeamTemplates, type TeamTemplate } from "@/lib/team-catalog";
import {
  Hammer,
  ClipboardList,
  Megaphone,
  Database,
  Palette,
  Server,
  Shield,
  FlaskConical,
  Users,
  Loader2,
  AlertTriangle,
} from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  hammer: Hammer,
  "clipboard-list": ClipboardList,
  megaphone: Megaphone,
  database: Database,
  palette: Palette,
  server: Server,
  shield: Shield,
  "flask-conical": FlaskConical,
};

interface UnassignedAgentSummary {
  id: string;
  name: string;
}

interface ReplaceAgentsModalProps {
  projectId: string;
  unassignedAgents: UnassignedAgentSummary[];
  onClose: () => void;
  onReplaced: () => void;
}

export default function ReplaceAgentsModal({
  projectId,
  unassignedAgents,
  onClose,
  onReplaced,
}: ReplaceAgentsModalProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const templates = useMemo(() => listTeamTemplates(), []);

  async function handleReplace() {
    if (!selectedTemplateId) return;

    setReplacing(true);
    setError(null);

    try {
      // 1. Delete each unassigned agent from the project
      await Promise.all(
        unassignedAgents.map((agent) =>
          fetch(
            `/api/projects/${projectId}/agents?agentId=${encodeURIComponent(agent.id)}`,
            { method: "DELETE" }
          )
        )
      );

      // 2. Create new team from template
      const teamRes = await fetch(`/api/projects/${projectId}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: selectedTemplateId }),
      });

      if (!teamRes.ok) {
        const data = await teamRes.json().catch(() => ({}));
        throw new Error(data.error || `Failed to create team (${teamRes.status})`);
      }

      onReplaced();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to replace agents");
      setReplacing(false);
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
            <h2 className="text-xl font-bold">Replace Unassigned Agents</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Remove unassigned agents and create a new team from a template.
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

          {/* Warning */}
          <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/20">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400 mb-2">
                  The following agents will be removed from this project:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {unassignedAgents.map((agent) => (
                    <span
                      key={agent.id}
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg bg-red-500/10 text-red-300 border border-red-500/20"
                    >
                      {agent.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Template picker grid */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Choose a replacement team
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {templates.map((template) => {
                const IconComponent = ICON_MAP[template.icon] || Users;
                const isSelected = selectedTemplateId === template.id;

                return (
                  <button
                    key={template.id}
                    onClick={() => setSelectedTemplateId(template.id)}
                    disabled={replacing}
                    className={`
                      text-left p-4 rounded-2xl border transition-all
                      ${
                        isSelected
                          ? "border-red-500/50 bg-red-500/5 ring-1 ring-red-500/30"
                          : replacing
                            ? "border-[var(--card-border)] bg-[var(--muted)]/10 cursor-wait"
                            : "border-[var(--card-border)] hover:border-[var(--primary)]/50 hover:bg-[var(--muted)]/30 cursor-pointer"
                      }
                    `}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`
                          w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
                          ${isSelected ? "bg-red-500/10" : "bg-[var(--primary)]/10"}
                        `}
                      >
                        <IconComponent
                          className={`w-5 h-5 ${isSelected ? "text-red-400" : "text-[var(--primary)]"}`}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{template.name}</span>
                          {isSelected && (
                            <span className="text-[10px] font-medium uppercase tracking-wider text-red-400">
                              Selected
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--muted-foreground)] mt-0.5 line-clamp-2">
                          {template.description}
                        </p>
                        <div className="flex items-center gap-1 mt-2 text-[11px] text-[var(--muted-foreground)]">
                          <Users className="w-3 h-3" />
                          <span>
                            {template.agents.length} agent
                            {template.agents.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-4 sm:px-8 sm:py-6 border-t border-[var(--card-border)] flex items-center justify-end gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={replacing}
            className="px-4 py-2 rounded-xl border border-[var(--card-border)] hover:bg-[var(--muted)]/50 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleReplace}
            disabled={!selectedTemplateId || replacing}
            className="px-5 py-2 rounded-xl text-sm font-medium min-w-[120px] flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {replacing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <AlertTriangle className="w-4 h-4" />
                Replace All
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
