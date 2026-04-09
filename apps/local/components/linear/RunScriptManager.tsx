"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Save, Trash2 } from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";
import RichTextEditor from "@/components/RichTextEditor";
import type { LinearRunScript } from "@/state/linearRunScripts";

type EditorMode =
  | { type: "new" }
  | { type: "edit"; scriptId: string };

interface RunScriptManagerProps {
  projectSlug?: string | null;
  scripts: LinearRunScript[];
  activeScriptId: string | null;
  onSetActiveScriptId: (scriptId: string | null) => void;
  onSaveScript: (input: { id?: string; name: string; prompt: string }) => LinearRunScript;
  onDeleteScript: (scriptId: string) => void;
}

function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function buildProjectLabel(projectSlug?: string | null): string {
  return String(projectSlug ?? "").trim() || "global Linear board";
}

export default function RunScriptManager({
  projectSlug,
  scripts,
  activeScriptId,
  onSetActiveScriptId,
  onSaveScript,
  onDeleteScript,
}: RunScriptManagerProps) {
  const activeScript = useMemo(
    () => scripts.find((script) => script.id === activeScriptId) ?? null,
    [activeScriptId, scripts]
  );
  const [editorMode, setEditorMode] = useState<EditorMode>(() =>
    activeScriptId ? { type: "edit", scriptId: activeScriptId } : { type: "new" }
  );
  const [draftName, setDraftName] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LinearRunScript | null>(null);
  const editingScriptId = editorMode.type === "edit" ? editorMode.scriptId : null;

  useEffect(() => {
    if (editorMode.type === "edit") {
      const script = scripts.find((entry) => entry.id === editorMode.scriptId);
      if (script) {
        setDraftName(script.name);
        setDraftPrompt(script.prompt);
        return;
      }
    }

    if (activeScript && editorMode.type !== "new") {
      if (editorMode.type !== "edit" || editorMode.scriptId !== activeScript.id) {
        setEditorMode({ type: "edit", scriptId: activeScript.id });
      }
      setDraftName(activeScript.name);
      setDraftPrompt(activeScript.prompt);
      return;
    }

    if (scripts.length === 0) {
      if (editorMode.type !== "new") {
        setEditorMode({ type: "new" });
        setDraftName("");
        setDraftPrompt("");
      }
    }
  }, [activeScript, editingScriptId, editorMode, scripts]);

  const selectScript = (script: LinearRunScript) => {
    setEditorMode({ type: "edit", scriptId: script.id });
    setDraftName(script.name);
    setDraftPrompt(script.prompt);
    setError(null);
    onSetActiveScriptId(script.id);
  };

  const startNewScript = () => {
    setEditorMode({ type: "new" });
    setDraftName("");
    setDraftPrompt("");
    setError(null);
  };

  const handleSaveNew = () => {
    try {
      const saved = onSaveScript({
        name: draftName,
        prompt: draftPrompt,
      });
      setEditorMode({ type: "edit", scriptId: saved.id });
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save session script.");
    }
  };

  const handleUpdate = () => {
    if (editorMode.type !== "edit") {
      handleSaveNew();
      return;
    }

    try {
      const saved = onSaveScript({
        id: editorMode.scriptId,
        name: draftName,
        prompt: draftPrompt,
      });
      setEditorMode({ type: "edit", scriptId: saved.id });
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update session script.");
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) {
      return;
    }

    onDeleteScript(deleteTarget.id);
    if (editorMode.type === "edit" && editorMode.scriptId === deleteTarget.id) {
      setEditorMode({ type: "new" });
      setDraftName("");
      setDraftPrompt("");
    }
    setDeleteTarget(null);
    setError(null);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">Session Scripts</h3>
        <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
          Save reusable kickoff prompts for the {buildProjectLabel(projectSlug)}. These scripts stay on this device and layer on top of the built-in ticket context whenever you start a scripted session.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
              Library
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-[var(--card-border)] px-2 py-1 text-[11px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--background)]"
              onClick={startNewScript}
            >
              <Plus size={12} />
              New
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                activeScriptId === null
                  ? "bg-[var(--background)] text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => onSetActiveScriptId(null)}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  activeScriptId === null
                    ? "border-blue-500 bg-blue-500 text-white"
                    : "border-[var(--card-border)]"
                }`}
              >
                {activeScriptId === null ? <Check size={10} /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">AGX default</span>
            </button>

            {scripts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--card-border)] px-3 py-4 text-xs leading-relaxed text-[var(--muted-foreground)]">
                No saved scripts yet. Create one to reuse your preferred scripted session prompt.
              </div>
            ) : (
              scripts.map((script) => {
                const isActive = script.id === activeScriptId;
                const isEditing = editorMode.type === "edit" && editorMode.scriptId === script.id;
                return (
                  <button
                    key={script.id}
                    type="button"
                    className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                      isEditing
                        ? "border-blue-500/50 bg-[var(--background)]"
                        : "border-transparent hover:border-[var(--card-border)] hover:bg-[var(--background)]"
                    }`}
                    onClick={() => selectScript(script)}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          isActive
                            ? "border-blue-500 bg-blue-500 text-white"
                            : "border-[var(--card-border)]"
                        }`}
                      >
                        {isActive ? <Check size={10} /> : null}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-[var(--foreground)]">
                          {script.name}
                        </div>
                        <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                          {script.prompt}
                        </div>
                        <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                          Updated {formatUpdatedAt(script.updatedAt)}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-[var(--foreground)]">
                {editorMode.type === "edit" ? "Edit Session Script" : "New Session Script"}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
                Use placeholders like <code>{"{{ticket.identifier}}"}</code>, <code>{"{{ticket.title}}"}</code>, <code>{"{{ticket.status}}"}</code>, <code>{"{{ticket.assignee}}"}</code>, <code>{"{{project.slug}}"}</code>, <code>{"{{knowledge_base.root}}"}</code>, <code>{"{{knowledge_base.issue_path}}"}</code>, and <code>{"{{worktree.path}}"}</code>.
              </p>
            </div>
            {activeScript ? (
              <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-400">
                Active: {activeScript.name}
              </span>
            ) : (
              <span className="rounded-full border border-[var(--card-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted-foreground)]">
                Active: AGX default
              </span>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                Name
              </span>
              <input
                type="text"
                className="rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-blue-500"
                placeholder="Investigation-first"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                Prompt
              </span>
              <div className="overflow-hidden rounded-lg border border-[var(--card-border)] bg-[var(--background)] transition-colors focus-within:border-blue-500 [&_.rich-text-editor_.ProseMirror]:min-h-[220px]">
                <RichTextEditor
                  content={draftPrompt}
                  onChange={setDraftPrompt}
                  placeholder={"Read {{ticket.identifier}} and the full comment thread in Linear before changing code.\nWrite your investigation to {{knowledge_base.issue_path}} and stop after posting a plan unless the issue is already approved for implementation."}
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
                onClick={handleSaveNew}
              >
                <Save size={14} />
                Save as new
              </button>
              {editorMode.type === "edit" ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--card-border)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--background)]"
                  onClick={handleUpdate}
                >
                  <Save size={14} />
                  Update
                </button>
              ) : null}
              {editorMode.type === "edit" ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10"
                  onClick={() => {
                    const script = scripts.find((entry) => entry.id === editorMode.scriptId) ?? null;
                    setDeleteTarget(script);
                  }}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--card-border)] px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                onClick={startNewScript}
              >
                <Plus size={14} />
                Clear editor
              </button>
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete session script?"
        message="This removes the saved script from this device for the current project."
        preview={deleteTarget?.name}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
