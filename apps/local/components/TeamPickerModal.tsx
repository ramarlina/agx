"use client";

import { useState } from "react";
import { listTeamTemplates, type TeamTemplate } from "@/lib/team-catalog";
import {
  Hammer,
  ClipboardList,
  Layers,
  Megaphone,
  Database,
  Palette,
  Server,
  Shield,
  FlaskConical,
  Plus,
  Users,
  Loader2,
} from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  layers: Layers,
  hammer: Hammer,
  "clipboard-list": ClipboardList,
  megaphone: Megaphone,
  database: Database,
  palette: Palette,
  server: Server,
  shield: Shield,
  "flask-conical": FlaskConical,
};

interface TeamPickerModalProps {
  projectId: string;
  existingTeamTemplateIds: string[];
  onClose: () => void;
  onTeamCreated: () => void;
}

export default function TeamPickerModal({
  projectId,
  existingTeamTemplateIds,
  onClose,
  onTeamCreated,
}: TeamPickerModalProps) {
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customName, setCustomName] = useState("");

  const templates = listTeamTemplates();

  async function createTeam(templateId: string, name?: string) {
    setCreatingId(templateId);
    setError(null);

    try {
      const body: { templateId: string; name?: string } = { templateId };
      if (name) body.name = name;

      const res = await fetch(`/api/projects/${projectId}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to create team (${res.status})`);
      }

      onTeamCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create team");
      setCreatingId(null);
    }
  }

  async function handleCustomCreate() {
    const trimmed = customName.trim();
    if (!trimmed) return;

    setCreatingId("__custom__");
    setError(null);

    try {
      const res = await fetch(`/api/projects/${projectId}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: "__custom__", name: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to create team (${res.status})`);
      }

      onTeamCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create team");
      setCreatingId(null);
    }
  }

  const isCreating = creatingId !== null;

  return (
    <div
      className="modal-backdrop p-2 sm:p-4 z-50 overflow-y-auto flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-content w-full max-w-3xl mx-2 sm:mx-auto bg-[var(--card-bg)] rounded-3xl border border-[var(--card-border)] shadow-2xl animate-scale-in flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-4 py-4 sm:px-8 sm:py-6 border-b border-[var(--card-border)] flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold">Add Team</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Choose a team template to add to your project.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-[var(--muted)]/50 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8">
          {error && (
            <div className="mb-4 p-4 rounded-xl bg-[var(--destructive-muted)] border border-[var(--destructive)]/20 text-sm text-[var(--destructive)]">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map((template) => {
              const alreadyAdded = existingTeamTemplateIds.includes(template.id);
              const IconComponent = ICON_MAP[template.icon] || Users;
              const isThisCreating = creatingId === template.id;

              return (
                <button
                  key={template.id}
                  onClick={() => !alreadyAdded && !isCreating && createTeam(template.id)}
                  disabled={alreadyAdded || isCreating}
                  className={`
                    text-left p-4 rounded-2xl border transition-all
                    ${
                      alreadyAdded
                        ? "border-[var(--card-border)] bg-[var(--muted)]/30 opacity-50 cursor-not-allowed"
                        : isCreating
                          ? "border-[var(--card-border)] bg-[var(--muted)]/10 cursor-wait"
                          : "border-[var(--card-border)] hover:border-[var(--primary)]/50 hover:bg-[var(--muted)]/30 cursor-pointer"
                    }
                  `}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`
                        w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
                        ${alreadyAdded ? "bg-[var(--muted)]/50" : "bg-[var(--primary)]/10"}
                      `}
                    >
                      {isThisCreating ? (
                        <Loader2 className="w-5 h-5 text-[var(--primary)] animate-spin" />
                      ) : (
                        <IconComponent
                          className={`w-5 h-5 ${alreadyAdded ? "text-[var(--muted-foreground)]" : "text-[var(--primary)]"}`}
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{template.name}</span>
                        {alreadyAdded && (
                          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                            Added
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--muted-foreground)] mt-0.5 line-clamp-2">
                        {template.description}
                      </p>
                      <div className="flex items-center gap-1 mt-2 text-[11px] text-[var(--muted-foreground)]">
                        <Users className="w-3 h-3" />
                        <span>
                          {template.agents.length} agent{template.agents.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Custom Team */}
          <div className="mt-6 border-t border-[var(--card-border)] pt-6">
            {showCustomInput ? (
              <div className="flex items-center gap-3">
                <input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Team name"
                  className="input flex-1 text-sm"
                  disabled={isCreating}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCustomCreate();
                    if (e.key === "Escape") {
                      setShowCustomInput(false);
                      setCustomName("");
                    }
                  }}
                />
                <button
                  onClick={handleCustomCreate}
                  disabled={!customName.trim() || isCreating}
                  className="btn-primary px-5 py-2 text-sm min-w-[80px]"
                >
                  {creatingId === "__custom__" ? (
                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  ) : (
                    "Create"
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowCustomInput(false);
                    setCustomName("");
                  }}
                  disabled={isCreating}
                  className="px-4 py-2 rounded-xl border border-[var(--card-border)] hover:bg-[var(--muted)]/50 transition-colors text-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowCustomInput(true)}
                disabled={isCreating}
                className="flex items-center gap-2 text-sm font-semibold text-[var(--primary)] hover:underline"
              >
                <Plus className="w-4 h-4" />
                Custom Team
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
