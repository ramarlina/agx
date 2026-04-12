"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";

interface EnvVar {
  key: string;
  isSet: boolean;
  revealedValue?: string;
  revealing?: boolean;
}

interface EnvironmentVariablesViewProps {
  projectId: string;
}

const KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export function EnvironmentVariablesView({ projectId }: EnvironmentVariablesViewProps) {
  const [variables, setVariables] = useState<EnvVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchVariables = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/variables`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setVariables(data.variables.map((v: { key: string; isSet: boolean }) => ({ key: v.key, isSet: v.isSet })));
      setError(null);
    } catch {
      setError("Failed to load environment variables");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchVariables();
  }, [fetchVariables]);

  const handleReveal = useCallback(async (key: string) => {
    setVariables((prev) =>
      prev.map((v) => (v.key === key ? { ...v, revealing: true } : v)),
    );
    try {
      const res = await fetch(`/api/projects/${projectId}/variables/${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setVariables((prev) =>
        prev.map((v) => (v.key === key ? { ...v, revealedValue: data.value, revealing: false } : v)),
      );
    } catch {
      setVariables((prev) =>
        prev.map((v) => (v.key === key ? { ...v, revealing: false } : v)),
      );
    }
  }, [projectId]);

  const handleHide = useCallback((key: string) => {
    setVariables((prev) =>
      prev.map((v) => (v.key === key ? { ...v, revealedValue: undefined } : v)),
    );
  }, []);

  const handleCreate = useCallback(async () => {
    const trimmedKey = newKey.trim();
    if (!trimmedKey) return;
    if (!KEY_PATTERN.test(trimmedKey)) {
      setSaveError("Key must use uppercase letters, digits, and underscores (e.g. MY_API_KEY)");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/variables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmedKey, value: newValue }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create");
      }
      setNewKey("");
      setNewValue("");
      setAdding(false);
      await fetchVariables();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to create variable");
    } finally {
      setSaving(false);
    }
  }, [projectId, newKey, newValue, fetchVariables]);

  const handleUpdate = useCallback(async (key: string) => {
    setEditSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/variables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: editValue }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setEditing(null);
      setEditValue("");
      setVariables((prev) =>
        prev.map((v) => (v.key === key ? { ...v, revealedValue: undefined } : v)),
      );
    } catch {
      // keep editing open on failure
    } finally {
      setEditSaving(false);
    }
  }, [projectId, editValue]);

  const handleDelete = useCallback(async (key: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/variables?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      setDeleting(null);
      await fetchVariables();
    } catch {
      setDeleting(null);
    }
  }, [projectId, fetchVariables]);

  const startEdit = useCallback(async (key: string) => {
    setEditing(key);
    setEditValue("");
    const v = variables.find((item) => item.key === key);
    if (v?.revealedValue !== undefined) {
      setEditValue(v.revealedValue);
    } else {
      try {
        const res = await fetch(`/api/projects/${projectId}/variables/${encodeURIComponent(key)}`);
        if (res.ok) {
          const data = await res.json();
          setEditValue(data.value);
        }
      } catch {
        // leave empty
      }
    }
  }, [projectId, variables]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--app-shell-border)]">
        <h2 className="text-sm font-medium text-[var(--foreground)]">Environment Variables</h2>
        <button
          type="button"
          onClick={() => { setAdding(true); setSaveError(null); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--primary)] text-white hover:opacity-90 transition-opacity"
        >
          <Plus size={12} />
          Add Variable
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <div className="text-sm text-red-500 mb-4">{error}</div>
        )}

        {adding && (
          <div className="mb-4 p-4 rounded-lg border border-[var(--app-shell-border)] bg-[var(--card)]">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">Key</label>
                <input
                  type="text"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                  placeholder="MY_API_KEY"
                  className="w-full px-3 py-2 text-sm rounded-md border border-[var(--app-shell-border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] font-mono"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">Value</label>
                <input
                  type="password"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="Enter value..."
                  className="w-full px-3 py-2 text-sm rounded-md border border-[var(--app-shell-border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] font-mono"
                />
              </div>
              {saveError && (
                <div className="text-xs text-red-500">{saveError}</div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={saving || !newKey.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : null}
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => { setAdding(false); setNewKey(""); setNewValue(""); setSaveError(null); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {variables.length === 0 && !adding && (
          <div className="text-sm text-[var(--muted-foreground)] text-center py-12">
            No environment variables configured for this project.
          </div>
        )}

        <div className="space-y-2">
          {variables.map((v) => (
            <div
              key={v.key}
              className="flex items-center gap-3 p-3 rounded-lg border border-[var(--app-shell-border)] bg-[var(--card)] group"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono font-medium text-[var(--foreground)]">{v.key}</div>

                {editing === v.key ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="flex-1 px-2 py-1 text-xs rounded border border-[var(--app-shell-border)] bg-[var(--background)] text-[var(--foreground)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleUpdate(v.key)}
                      disabled={editSaving}
                      className="px-2 py-1 text-xs font-medium rounded bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {editSaving ? <Loader2 size={10} className="animate-spin" /> : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="text-xs text-[var(--muted-foreground)] font-mono mt-0.5">
                    {v.revealing ? (
                      <Loader2 size={10} className="animate-spin inline" />
                    ) : v.revealedValue !== undefined ? (
                      v.revealedValue || <span className="italic">(empty)</span>
                    ) : (
                      "••••••••"
                    )}
                  </div>
                )}
              </div>

              {editing !== v.key && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {v.revealedValue !== undefined ? (
                    <button
                      type="button"
                      onClick={() => handleHide(v.key)}
                      className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
                      title="Hide value"
                    >
                      <EyeOff size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleReveal(v.key)}
                      disabled={v.revealing}
                      className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
                      title="Reveal value"
                    >
                      <Eye size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => startEdit(v.key)}
                    className="px-2 py-1 text-xs rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
                  >
                    Edit
                  </button>

                  {deleting === v.key ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleDelete(v.key)}
                        className="px-2 py-1 text-xs rounded font-medium text-red-500 hover:bg-red-500/10 transition-colors"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(null)}
                        className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeleting(v.key)}
                      className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
