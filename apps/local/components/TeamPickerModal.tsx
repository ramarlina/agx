"use client";

import { useState, useMemo } from "react";
import {
  listTeamTemplates,
  listAgentPresets,
  type AgentPresetId,
} from "@/lib/team-catalog";
import SearchCombo, { type ComboOption } from "@/components/SearchCombo";
import {
  Plus,
  Search,
  Users,
  Loader2,
  Check,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [selectedPresetIds, setSelectedPresetIds] = useState<Set<AgentPresetId>>(new Set());
  const [teamName, setTeamName] = useState("");
  const [roleSearch, setRoleSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Build options
  const templateOptions: ComboOption[] = useMemo(
    () =>
      templates.map((t) => ({
        id: t.id,
        label: t.name,
        description: t.description,
        meta: t.variants ? `${t.variants.length} specializations` : `${t.agents.length} roles`,
        disabled: existingTeamTemplateIds.includes(t.id),
      })),
    [templates, existingTeamTemplateIds],
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

  const selectedPresets = useMemo(
    () => allPresets.filter((p) => selectedPresetIds.has(p.id)),
    [allPresets, selectedPresetIds],
  );

  const availablePresets = useMemo(() => {
    const q = roleSearch.toLowerCase();
    return allPresets.filter(
      (p) =>
        !selectedPresetIds.has(p.id) &&
        (!q || p.name.toLowerCase().includes(q) || p.id.includes(q) || p.skillProfileId.includes(q)),
    );
  }, [allPresets, selectedPresetIds, roleSearch]);

  // When template changes, auto-select defaults
  function handleTemplateChange(id: string) {
    setSelectedTemplateId(id);
    setSelectedVariantId(null);
    setError(null);
    const t = templates.find((t) => t.id === id);
    if (t) {
      setTeamName(t.name);
      if (!t.variants) {
        setSelectedPresetIds(new Set(t.agents.map((a) => a.id)));
      } else {
        setSelectedPresetIds(new Set());
      }
    }
  }

  function handleVariantChange(id: string) {
    setSelectedVariantId(id);
    const v = selectedTemplate?.variants?.find((v) => v.id === id);
    if (v) {
      setTeamName(v.name);
      setSelectedPresetIds(new Set(v.agents.map((a) => a.id)));
    }
  }

  function togglePreset(id: AgentPresetId) {
    setSelectedPresetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreate() {
    if (!selectedTemplate || selectedPresetIds.size === 0) return;

    setCreating(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        templateId: selectedTemplate.id,
        name: teamName.trim() || selectedTemplate.name,
        agents: [...selectedPresetIds],
      };
      if (selectedVariantId) body.variantId = selectedVariantId;

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
      setCreating(false);
    }
  }

  async function handleCustomCreate() {
    if (!teamName.trim()) return;
    setCreating(true);
    setError(null);

    try {
      const body: Record<string, unknown> = { name: teamName.trim() };
      if (selectedPresetIds.size > 0) {
        body.templateId = selectedTemplateId || "__custom__";
        body.agents = [...selectedPresetIds];
      }

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
      setCreating(false);
    }
  }

  const hasVariants = !!selectedTemplate?.variants;
  const isConfigured = selectedPresetIds.size > 0;
  const canCreate = teamName.trim() && isConfigured;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div
        className="relative w-full max-w-xl flex flex-col h-full border-l"
        style={{ background: "var(--card-bg)", borderColor: "var(--border)" }}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b flex items-center justify-between flex-shrink-0" style={{ borderColor: "var(--border)" }}>
          <div>
            <h2 className="text-lg font-bold">Add Team</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Pick a template, customize roles, and create.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[var(--muted)]/50 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-[var(--destructive-muted)] border border-[var(--destructive)]/20 text-sm text-[var(--destructive)]">
              {error}
            </div>
          )}

          {/* Team name */}
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

          {/* Template dropdown */}
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

          {/* Variant dropdown */}
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

          {/* Selected roles */}
          {isConfigured && (
            <div>
              <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">
                Roles ({selectedPresets.length})
              </label>
              <div className="space-y-1.5">
                {selectedPresets.map((preset) => (
                  <div
                    key={preset.id}
                    className="flex items-center justify-between py-2 px-3 rounded-xl"
                    style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 bg-emerald-500/15">
                        <Check className="w-3 h-3 text-emerald-400" />
                      </div>
                      <span className="text-sm font-medium truncate">{preset.role}</span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: "var(--card-bg)", color: "var(--muted-foreground)" }}
                      >
                        {preset.skillProfileId}
                      </span>
                    </div>
                    <button
                      onClick={() => togglePreset(preset.id)}
                      disabled={creating}
                      className="p-1.5 rounded-lg hover:bg-red-500/15 text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
                      title={`Remove ${preset.role}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add more roles */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">
              {isConfigured ? "Add more roles" : "Roles"}
            </label>
            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                value={roleSearch}
                onChange={(e) => setRoleSearch(e.target.value)}
                placeholder="Search all roles..."
                className="input w-full text-sm"
                style={{ paddingLeft: "2.25rem" }}
                disabled={creating}
              />
              {roleSearch && (
                <button
                  onClick={() => setRoleSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto">
              {availablePresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => togglePreset(preset.id)}
                  disabled={creating}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
                  style={{
                    background: "var(--muted)",
                    border: "1px solid var(--border)",
                    color: "var(--muted-foreground)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--primary)";
                    e.currentTarget.style.color = "var(--primary)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.color = "var(--muted-foreground)";
                  }}
                >
                  <Plus className="w-3 h-3" />
                  {preset.role}
                </button>
              ))}
              {availablePresets.length === 0 && (
                <span className="text-xs text-[var(--muted-foreground)] py-2">
                  {roleSearch ? "No matching roles" : "All roles selected"}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-end gap-3 flex-shrink-0" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={onClose}
            disabled={creating}
            className="px-4 py-2 rounded-xl border border-[var(--card-border)] hover:bg-[var(--muted)]/50 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={selectedTemplate ? handleCreate : handleCustomCreate}
            disabled={!teamName.trim() || (!selectedTemplate && selectedPresetIds.size === 0) || creating}
            className="btn-primary px-5 py-2 text-sm min-w-[120px] flex items-center justify-center gap-2"
          >
            {creating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Users className="w-4 h-4" />
                Create{isConfigured ? ` (${selectedPresetIds.size})` : ""}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
