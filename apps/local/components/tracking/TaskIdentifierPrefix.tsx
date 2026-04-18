"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

const PREFIX_REGEX = /^[A-Z]{2,10}$/;

export function TaskIdentifierPrefix({
  projectId,
  trackerType,
}: {
  projectId: string;
  trackerType?: string;
}) {
  if (trackerType === "github") return null;

  return <TaskIdentifierPrefixInner projectId={projectId} />;
}

function TaskIdentifierPrefixInner({ projectId }: { projectId: string }) {
  const [prefix, setPrefix] = useState("");
  const [initialPrefix, setInitialPrefix] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const loadProject = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load project");
      const data = (await res.json()) as { project: { identifier_prefix?: string | null } };
      const existing = data.project?.identifier_prefix ?? null;
      setInitialPrefix(existing);
      setPrefix(existing ?? "");
      setLoadError(null);
    } catch {
      setLoadError("Failed to load project settings");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  const validate = useCallback((value: string) => {
    if (!value) return null;
    if (!PREFIX_REGEX.test(value)) {
      return "Must be 2-10 uppercase letters (e.g. TSK, AGX).";
    }
    return null;
  }, []);

  const handleSave = useCallback(
    async (nextValue: string | null) => {
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ identifier_prefix: nextValue }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string })?.error ?? "Failed to save");
        }
        const data = (await res.json()) as { project: { identifier_prefix?: string | null } };
        const applied = data.project?.identifier_prefix ?? null;
        setInitialPrefix(applied);
        setPrefix(applied ?? "");
        setSavedAt(Date.now());
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [projectId],
  );

  const onSaveClick = () => {
    const trimmed = prefix.trim().toUpperCase();
    const err = validate(trimmed);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    void handleSave(trimmed ? trimmed : null);
  };

  const onClearClick = () => {
    setValidationError(null);
    void handleSave(null);
  };

  const dirty = (initialPrefix ?? "") !== prefix.trim().toUpperCase();

  return (
    <section className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 space-y-4 mx-6 mb-6">
      <div>
        <h2 className="text-sm font-medium">Task identifier prefix</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Used to identify tasks in branches, PR titles, and links (e.g.{" "}
          <span className="font-mono">TSK-42</span>). Set once; existing tasks keep their current
          identifiers.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading...
        </div>
      ) : loadError ? (
        <p className="text-sm text-red-500">{loadError}</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={prefix}
              onChange={(e) => {
                setPrefix(e.target.value.toUpperCase());
                setValidationError(null);
                setSaveError(null);
              }}
              onBlur={(e) => {
                const v = e.target.value.trim().toUpperCase();
                setValidationError(validate(v));
              }}
              placeholder="TSK"
              maxLength={10}
              className="w-40 px-2 py-1.5 text-sm font-mono rounded border border-zinc-300 dark:border-zinc-700 bg-transparent"
            />
            <button
              type="button"
              onClick={onSaveClick}
              disabled={saving || !dirty || !!validationError}
              className="text-xs px-3 py-1.5 rounded bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            {initialPrefix ? (
              <button
                type="button"
                onClick={onClearClick}
                disabled={saving}
                className="text-xs px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
              >
                Clear
              </button>
            ) : null}
          </div>
          <p className="text-xs text-zinc-500">
            2-10 uppercase letters, matching{" "}
            <span className="font-mono">/^[A-Z]{"{2,10}"}$/</span>.
          </p>
          {validationError && <p className="text-xs text-red-500">{validationError}</p>}
          {saveError && <p className="text-xs text-red-500">{saveError}</p>}
          {savedAt && !saveError && !validationError && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">Saved.</p>
          )}
        </div>
      )}
    </section>
  );
}
