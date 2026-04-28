"use client";

import type { ChangeEvent } from "react";
import { useCallback, useRef, useState } from "react";
import {
  Download,
  FileText,
  FolderGit2,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  Save,
  Settings,
  TerminalSquare,
  Trash2,
  Upload,
  X,
  Folder,
} from "lucide-react";
import type { WorkspaceEntry } from "@/lib/db/types";
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace";
import { buildWorkspaceCategoryGroups } from "@/lib/project-workspace";
import { DEFAULT_WORKSPACE_CATEGORIES } from "@/lib/workspace-categories";
import { RepoPathCombobox } from "@/components/projects/RepoPathCombobox";

interface FoldersViewProps {
  projectId: string;
}

type StatusTone = "success" | "error" | "neutral";

interface EntryDraft {
  category: string;
  name: string;
  path: string;
  purpose: string;
  error: string | null;
  isSaving: boolean;
}

function getCategoryEntryLabel(categoryId: string, label: string): string {
  switch (categoryId) {
    case "repositories":
      return "Repository";
    case "docs":
      return "Doc";
    case "config":
      return "Config";
    case "scripts":
      return "Script";
    default:
      return label;
  }
}

function createEntryDraft(category: string, entry?: WorkspaceEntry): EntryDraft {
  return {
    category,
    name: entry?.name ?? "",
    path: entry?.path ?? "",
    purpose: entry?.purpose ?? "",
    error: null,
    isSaving: false,
  };
}

function getCategoryIcon(categoryId: string) {
  switch (categoryId) {
    case "repositories":
      return FolderGit2;
    case "docs":
      return FileText;
    case "config":
      return Settings;
    case "scripts":
      return TerminalSquare;
    default:
      return Folder;
  }
}

export function FoldersView({ projectId }: FoldersViewProps) {
  const { workspace, entryCount, isLoading, error, refetch, createEntry, updateEntry, deleteEntry } = useProjectWorkspace(projectId);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [addingCategoryId, setAddingCategoryId] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState<EntryDraft>(createEntryDraft("repositories"));
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EntryDraft | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [status, setStatus] = useState<{ tone: StatusTone; message: string } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const groups = buildWorkspaceCategoryGroups(workspace, customCategories);
  const showEmptyState = entryCount === 0 && customCategories.length === 0 && !addingCategoryId;

  const setFeedback = useCallback((message: string, tone: StatusTone = "neutral") => {
    setStatus({ tone, message });
    window.setTimeout(() => setStatus(null), 3500);
  }, []);

  const pickFolder = useCallback(async () => {
    const response = await fetch("/api/filesystem/pick-folder", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof data.error === "string" ? data.error : "Failed to open folder picker");
    }
    return typeof data.path === "string" ? data.path : null;
  }, []);

  const closeAddForm = useCallback(() => {
    setAddingCategoryId(null);
    setAddDraft(createEntryDraft("repositories"));
  }, []);

  const openAddForm = useCallback((category: string) => {
    setAddingCategoryId(category);
    setAddDraft(createEntryDraft(category));
    setEditingEntryId(null);
    setEditDraft(null);
  }, []);

  const openEditForm = useCallback((entry: WorkspaceEntry) => {
    setEditingEntryId(entry.id);
    setEditDraft(createEntryDraft(entry.category, entry));
    setAddingCategoryId(null);
    setAddDraft(createEntryDraft(entry.category));
  }, []);

  const closeEditForm = useCallback(() => {
    setEditingEntryId(null);
    setEditDraft(null);
  }, []);

  const handleAddEntry = useCallback(async () => {
    const name = addDraft.name.trim();
    if (!name) {
      setAddDraft((current) => ({ ...current, error: "Name is required" }));
      return;
    }

    setAddDraft((current) => ({ ...current, isSaving: true, error: null }));
    try {
      await createEntry({
        category: addDraft.category,
        name,
        path: addDraft.path.trim() || null,
        purpose: addDraft.purpose.trim() || null,
      });
      closeAddForm();
      setFeedback(`Added ${name} to ${groups.find((group) => group.id === addDraft.category)?.label ?? "workspace map"}`, "success");
    } catch (err) {
      setAddDraft((current) => ({
        ...current,
        isSaving: false,
        error: err instanceof Error ? err.message : "Failed to add workspace entry",
      }));
    }
  }, [addDraft, closeAddForm, createEntry, groups, setFeedback]);

  const handleSaveEdit = useCallback(async () => {
    if (!editingEntryId || !editDraft) return;
    const name = editDraft.name.trim();
    if (!name) {
      setEditDraft((current) => (current ? { ...current, error: "Name is required" } : current));
      return;
    }

    setEditDraft((current) => (current ? { ...current, isSaving: true, error: null } : current));
    try {
      await updateEntry(editingEntryId, {
        name,
        path: editDraft.path.trim() || null,
        purpose: editDraft.purpose.trim() || null,
      });
      closeEditForm();
      setFeedback("Workspace entry updated", "success");
    } catch (err) {
      setEditDraft((current) => ({
        ...(current ?? createEntryDraft("")),
        isSaving: false,
        error: err instanceof Error ? err.message : "Failed to update workspace entry",
      }));
    }
  }, [closeEditForm, editDraft, editingEntryId, setFeedback, updateEntry]);

  const handleDeleteEntry = useCallback(async (entry: WorkspaceEntry) => {
    if (!window.confirm(`Delete ${entry.name} from ${entry.category}?`)) return;
    try {
      await deleteEntry(entry.id);
      if (editingEntryId === entry.id) {
        closeEditForm();
      }
      setFeedback(`Deleted ${entry.name}`, "success");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Failed to delete workspace entry", "error");
    }
  }, [closeEditForm, deleteEntry, editingEntryId, setFeedback]);

  const handleBrowseForAdd = useCallback(async () => {
    try {
      const path = await pickFolder();
      if (path) {
        setAddDraft((current) => ({ ...current, path, error: null }));
      }
    } catch (err) {
      setAddDraft((current) => ({
        ...current,
        error: err instanceof Error ? err.message : "Failed to pick folder",
      }));
    }
  }, [pickFolder]);

  const handleBrowseForEdit = useCallback(async () => {
    if (!editDraft) return;
    try {
      const path = await pickFolder();
      if (path) {
        setEditDraft((current) => (current ? { ...current, path, error: null } : current));
      }
    } catch (err) {
      setEditDraft((current) => (
        current
          ? { ...current, error: err instanceof Error ? err.message : "Failed to pick folder" }
          : current
      ));
    }
  }, [editDraft, pickFolder]);

  const handleQuickBrowse = useCallback(async (entry: WorkspaceEntry) => {
    try {
      const path = await pickFolder();
      if (!path) return;
      await updateEntry(entry.id, { path });
      setFeedback(`Updated path for ${entry.name}`, "success");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Failed to update path", "error");
    }
  }, [pickFolder, setFeedback, updateEntry]);

  const handleCreateCategory = useCallback(() => {
    const nextCategory = categoryDraft.trim();
    if (!nextCategory) return;

    const existingGroup = groups.find(
      (group) =>
        group.id.toLowerCase() === nextCategory.toLowerCase() ||
        group.label.toLowerCase() === nextCategory.toLowerCase(),
    );

    if (existingGroup) {
      setCategoryDraft("");
      setIsCreatingCategory(false);
      openAddForm(existingGroup.id);
      return;
    }

    setCustomCategories((current) => [...current, nextCategory]);
    setCategoryDraft("");
    setIsCreatingCategory(false);
    openAddForm(nextCategory);
  }, [categoryDraft, groups, openAddForm]);

  const handleRemoveCustomCategory = useCallback((categoryId: string) => {
    setCustomCategories((current) => current.filter((category) => category !== categoryId));
    if (addingCategoryId === categoryId) {
      closeAddForm();
    }
  }, [addingCategoryId, closeAddForm]);

  const handleExportYaml = useCallback(() => {
    window.open(`/api/projects/${projectId}/workspace/export`, "_blank");
  }, [projectId]);

  const handleImportYaml = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      const response = await fetch(`/api/projects/${projectId}/workspace/import`, {
        method: "POST",
        headers: { "Content-Type": "application/x-yaml" },
        body: content,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "Failed to import workspace YAML");
      }
      await refetch();
      setFeedback("Imported workspace YAML", "success");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Failed to import workspace YAML", "error");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }, [projectId, refetch, setFeedback]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
        <section className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
                <FolderGit2 className="h-3.5 w-3.5" />
                Project Setup
              </div>
              <h1 className="text-2xl font-semibold text-[var(--foreground)]">Workspace Map</h1>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                Map your project&apos;s folders so agents know where things live. Group repositories, docs, config, and
                scripts into a workspace that people and automation can navigate without guesswork.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsCreatingCategory((current) => !current)}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
              >
                <FolderPlus className="h-4 w-4" />
                Add Category
              </button>
              <button
                type="button"
                onClick={handleExportYaml}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
              >
                <Download className="h-4 w-4" />
                Export YAML
              </button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]">
                <Upload className="h-4 w-4" />
                Import YAML
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".yaml,.yml"
                  onChange={handleImportYaml}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {isCreatingCategory && (
            <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--secondary)]/30 p-4 md:flex-row md:items-center">
              <input
                value={categoryDraft}
                onChange={(event) => setCategoryDraft(event.target.value)}
                placeholder="Custom category name"
                className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCreateCategory}
                  disabled={!categoryDraft.trim()}
                  className="rounded-xl bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] disabled:opacity-40"
                >
                  Create Category
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingCategory(false);
                    setCategoryDraft("");
                  }}
                  className="rounded-xl px-3 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {status && (
            <p
              className={`mt-4 text-sm ${
                status.tone === "error"
                  ? "text-[var(--destructive)]"
                  : status.tone === "success"
                    ? "text-emerald-500"
                    : "text-[var(--muted-foreground)]"
              }`}
            >
              {status.message}
            </p>
          )}
        </section>

        {isLoading && (
          <section className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8">
            <div className="flex items-center gap-3 text-sm text-[var(--muted-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading workspace map...
            </div>
          </section>
        )}

        {!isLoading && error && (
          <section className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8">
            <div className="space-y-3">
              <p className="text-sm text-[var(--destructive)]">{error.message || "Failed to load workspace map"}</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
              >
                Try Again
              </button>
            </div>
          </section>
        )}

        {!isLoading && !error && showEmptyState && (
          <section className="rounded-3xl border border-dashed border-[var(--border)] bg-[var(--card-bg)] p-10 text-center">
            <div className="mx-auto max-w-2xl">
              <h2 className="text-xl font-semibold text-[var(--foreground)]">Tell your agents where things live.</h2>
              <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                Add folders to your workspace so agents can find and work in the right places. Start with a repository,
                docs, or config, or import a shared workspace definition.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                {DEFAULT_WORKSPACE_CATEGORIES.slice(0, 3).map((category) => {
                  const Icon = getCategoryIcon(category.id);
                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => openAddForm(category.id)}
                      className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
                    >
                      <Icon className="h-4 w-4" />
                      Add {getCategoryEntryLabel(category.id, category.label)}
                    </button>
                  );
                })}
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]">
                  <Upload className="h-4 w-4" />
                  Import YAML
                  <input
                    type="file"
                    accept=".yaml,.yml"
                    onChange={handleImportYaml}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </section>
        )}

        {!isLoading && !error && !showEmptyState && (
          <div className="space-y-4">
            {groups.map((group) => {
              const Icon = getCategoryIcon(group.id);

              return (
                <section
                  key={group.id}
                  className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6"
                >
                  <div className="flex flex-col gap-4 border-b border-[var(--border)] pb-4 md:flex-row md:items-start md:justify-between">
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--secondary)]/40 p-3">
                        <Icon className="h-5 w-5 text-[var(--muted-foreground)]" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-[var(--foreground)]">{group.label}</h2>
                        <p className="text-sm text-[var(--muted-foreground)]">
                          {group.entries.length > 0
                            ? `${group.entries.length} location${group.entries.length === 1 ? "" : "s"} mapped`
                            : group.isPreset
                              ? `No ${group.label.toLowerCase()} mapped yet`
                              : "Custom category ready for entries"}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!group.isPreset && group.isEmpty && (
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomCategory(group.id)}
                          className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
                        >
                          <Trash2 className="h-4 w-4" />
                          Remove Empty Category
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openAddForm(group.id)}
                        className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
                      >
                        <Plus className="h-4 w-4" />
                        Add to {group.label}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {group.entries.length === 0 && addingCategoryId !== group.id && (
                      <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-5 text-sm text-[var(--muted-foreground)]">
                        {group.isPreset
                          ? `Start this section by adding a ${getCategoryEntryLabel(group.id, group.label).toLowerCase()} and selecting a folder on disk.`
                          : "This custom category is empty until you add its first folder."}
                      </p>
                    )}

                    {group.entries.map((entry) => {
                      const isEditing = editingEntryId === entry.id && editDraft;
                      return (
                        <div
                          key={entry.id}
                          className="rounded-2xl border border-[var(--border)] bg-[var(--secondary)]/20 p-4"
                        >
                          {!isEditing && (
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-base font-medium text-[var(--foreground)]">{entry.name}</p>
                                </div>
                                <p className="mt-2 break-all font-mono text-xs text-[var(--muted-foreground)]">
                                  {entry.path || "No path selected yet"}
                                </p>
                                <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                                  {entry.purpose || "No purpose documented yet."}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void handleQuickBrowse(entry)}
                                  className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
                                >
                                  Browse
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditForm(entry)}
                                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
                                >
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteEntry(entry)}
                                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </button>
                              </div>
                            </div>
                          )}

                          {isEditing && editDraft && (
                            <div className="space-y-3">
                              <div className="grid gap-3 md:grid-cols-2">
                                <label className="block">
                                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                                    Name
                                  </span>
                                  <input
                                    value={editDraft.name}
                                    onChange={(event) =>
                                      setEditDraft((current) =>
                                        current ? { ...current, name: event.target.value, error: null } : current,
                                      )
                                    }
                                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                                    Path
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <RepoPathCombobox
                                      category={editDraft.category}
                                      value={editDraft.path}
                                      onChange={(next) =>
                                        setEditDraft((current) =>
                                          current ? { ...current, path: next, error: null } : current,
                                        )
                                      }
                                      onSelectMatch={(repo) =>
                                        setEditDraft((current) => {
                                          if (!current) return current;
                                          const nextName =
                                            current.name.trim().length === 0 ? repo.basename : current.name;
                                          return { ...current, name: nextName, path: repo.path, error: null };
                                        })
                                      }
                                      placeholder="/Users/you/Projects/repo"
                                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => void handleBrowseForEdit()}
                                      className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
                                    >
                                      Browse
                                    </button>
                                  </div>
                                </label>
                              </div>
                              <label className="block">
                                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                                  Purpose
                                </span>
                                <textarea
                                  value={editDraft.purpose}
                                  onChange={(event) =>
                                    setEditDraft((current) =>
                                      current ? { ...current, purpose: event.target.value, error: null } : current,
                                    )
                                  }
                                  className="min-h-24 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-3 text-sm text-[var(--foreground)]"
                                  placeholder="What should agents or teammates expect in this folder?"
                                />
                              </label>
                              {editDraft.error && (
                                <p className="text-sm text-[var(--destructive)]">{editDraft.error}</p>
                              )}
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void handleSaveEdit()}
                                  disabled={editDraft.isSaving}
                                  className="inline-flex items-center gap-2 rounded-xl bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] disabled:opacity-40"
                                >
                                  {editDraft.isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                  Save Changes
                                </button>
                                <button
                                  type="button"
                                  onClick={closeEditForm}
                                  className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                                >
                                  <X className="h-4 w-4" />
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {addingCategoryId === group.id && (
                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                        <div className="mb-3 flex items-center gap-2">
                          <Plus className="h-4 w-4 text-[var(--muted-foreground)]" />
                          <p className="text-sm font-medium text-[var(--foreground)]">Add to {group.label}</p>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="block">
                            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                              Name
                            </span>
                            <input
                              value={addDraft.name}
                              onChange={(event) =>
                                setAddDraft((current) => ({ ...current, name: event.target.value, error: null }))
                              }
                              className="w-full rounded-xl border border-[var(--border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--foreground)]"
                              placeholder="backend, handbook, deploy"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                              Path
                            </span>
                            <div className="flex items-center gap-2">
                              <RepoPathCombobox
                                category={addDraft.category}
                                value={addDraft.path}
                                onChange={(next) =>
                                  setAddDraft((current) => ({ ...current, path: next, error: null }))
                                }
                                onSelectMatch={(repo) =>
                                  setAddDraft((current) => {
                                    const nextName =
                                      current.name.trim().length === 0 ? repo.basename : current.name;
                                    return { ...current, name: nextName, path: repo.path, error: null };
                                  })
                                }
                                placeholder="/Users/you/Projects/repo"
                                className="w-full rounded-xl border border-[var(--border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--foreground)]"
                              />
                              <button
                                type="button"
                                onClick={() => void handleBrowseForAdd()}
                                className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
                              >
                                Browse
                              </button>
                            </div>
                          </label>
                        </div>
                        <label className="mt-3 block">
                          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                            Purpose
                          </span>
                          <textarea
                            value={addDraft.purpose}
                            onChange={(event) =>
                              setAddDraft((current) => ({ ...current, purpose: event.target.value, error: null }))
                            }
                            className="min-h-24 w-full rounded-xl border border-[var(--border)] bg-[var(--card-bg)] px-3 py-3 text-sm text-[var(--foreground)]"
                            placeholder="Describe what lives here and why it matters."
                          />
                        </label>
                        {addDraft.error && (
                          <p className="mt-3 text-sm text-[var(--destructive)]">{addDraft.error}</p>
                        )}
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleAddEntry()}
                            disabled={addDraft.isSaving}
                            className="inline-flex items-center gap-2 rounded-xl bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] disabled:opacity-40"
                          >
                            {addDraft.isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Save Entry
                          </button>
                          <button
                            type="button"
                            onClick={closeAddForm}
                            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                          >
                            <X className="h-4 w-4" />
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
