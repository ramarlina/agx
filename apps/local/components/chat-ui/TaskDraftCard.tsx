"use client";

import { useState, useCallback } from "react";
import type { TaskDraft, TaskDraftMessage } from "@/types/tasks";
import { Zap, GripVertical, ChevronDown, ChevronRight, Plus, X, ArrowUpRight, Pencil, Copy, Check } from "lucide-react";
import { ProjectPicker } from "./ProjectPicker";

interface Props {
  draft: TaskDraftMessage;
  onUpdate: (draft: TaskDraftMessage) => void;
  onBuild: (draft: TaskDraftMessage, projectId: string, projectName: string) => void;
  building?: boolean;
}

export function TaskDraftCard({ draft, onUpdate, onBuild, building }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyAsMarkdown = useCallback(() => {
    const md = draft.tasks
      .map((t, i) => {
        let line = `${i + 1}. **${t.title}**`;
        if (t.description && t.description !== "Add description...") {
          line += `\n   ${t.description.replace(/\n/g, "\n   ")}`;
        }
        return line;
      })
      .join("\n");
    navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [draft.tasks]);

  const updateTask = useCallback(
    (taskId: string, updates: Partial<TaskDraft>) => {
      const tasks = draft.tasks.map((t) =>
        t.id === taskId ? { ...t, ...updates } : t
      );
      onUpdate({ ...draft, tasks, revision: draft.revision + 1 });
    },
    [draft, onUpdate]
  );

  const removeTask = useCallback(
    (taskId: string) => {
      const tasks = draft.tasks.filter((t) => t.id !== taskId);
      onUpdate({ ...draft, tasks, revision: draft.revision + 1 });
    },
    [draft, onUpdate]
  );

  const addTask = useCallback(() => {
    const newTask: TaskDraft = {
      id: crypto.randomUUID(),
      title: "New task",
      description: "Add description...",
    };
    onUpdate({
      ...draft,
      tasks: [...draft.tasks, newTask],
      revision: draft.revision + 1,
    });
  }, [draft, onUpdate]);

  const handleBuildClick = useCallback(() => {
    setShowProjectPicker(true);
  }, []);

  const handleProjectSelect = useCallback(
    (projectId: string, projectName: string) => {
      setShowProjectPicker(false);
      onBuild(draft, projectId, projectName);
    },
    [draft, onBuild]
  );

  const isEditable = draft.buildStatus === "idle" || !draft.buildStatus;

  return (
    <div className="mt-6 p-4 bg-[var(--app-shell-subtle)]/80 rounded-2xl border border-[var(--border)] shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">
            Tasks
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-[var(--muted-foreground)]">
            {draft.tasks.length} task{draft.tasks.length !== 1 ? "s" : ""}
          </span>
          {draft.tasks.length > 0 && (
            <button
              type="button"
              onClick={copyAsMarkdown}
              className="text-[var(--muted-foreground)] hover:text-[var(--muted-foreground)] transition-colors"
              title="Copy as markdown"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1 mb-4">
        {draft.tasks.map((task) => {
          const isExpanded = expandedId === task.id;
          return (
            <div key={task.id} className="group">
              <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-[var(--app-shell-subtle)] transition-colors">
                {isEditable && (
                  <GripVertical className="w-3.5 h-3.5 text-[var(--app-shell-soft-text)] opacity-0 group-hover:opacity-100 cursor-grab shrink-0" />
                )}
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : task.id)}
                  className="shrink-0 text-[var(--app-shell-muted)] hover:text-[var(--foreground)]"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
                {isEditable ? (
                  <input
                    type="text"
                    value={task.title}
                    onChange={(e) => updateTask(task.id, { title: e.target.value })}
                    className="flex-1 text-xs font-semibold text-[var(--foreground)] bg-transparent border-none outline-none focus:ring-0 p-0"
                  />
                ) : (
                  <span className="flex-1 text-xs font-semibold text-[var(--foreground)]">
                    {task.title}
                  </span>
                )}
                {isEditable && (
                  <button
                    type="button"
                    onClick={() => removeTask(task.id)}
                    className="shrink-0 text-[var(--app-shell-soft-text)] hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {isExpanded && (
                <div className="ml-9 mr-2 mb-2">
                  {isEditable ? (
                    <textarea
                      value={task.description}
                      onChange={(e) =>
                        updateTask(task.id, { description: e.target.value })
                      }
                      rows={4}
                      className="w-full text-xs text-[var(--muted-foreground)] bg-[var(--input)] border border-[var(--app-shell-border)] rounded-lg p-2 outline-none focus:ring-1 focus:ring-[var(--ring)] resize-y"
                    />
                  ) : (
                    <p className="text-xs text-[var(--muted-foreground)] whitespace-pre-wrap">
                      {task.description}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        {isEditable && (
          <button
            type="button"
            onClick={addTask}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[var(--app-shell-muted)] hover:text-[var(--foreground)] rounded-full border border-dashed border-[var(--app-shell-border)] hover:border-[var(--app-shell-border-strong)] transition-all"
          >
            <Plus className="w-3 h-3" />
            Add task
          </button>
        )}
        <div className="flex-1" />
        {isEditable && (
          <button
            type="button"
            onClick={handleBuildClick}
            disabled={building || draft.tasks.length === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-[var(--primary-foreground)] bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-full shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowUpRight className="w-3 h-3" />
            {building ? "Pushing…" : "Push to agx"}
          </button>
        )}
      </div>

      {showProjectPicker && (
        <ProjectPicker
          onSelect={handleProjectSelect}
          onClose={() => setShowProjectPicker(false)}
        />
      )}
    </div>
  );
}
