"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectWithRepos } from "@/hooks/useProjects";
import DirectoryBrowser from "@/components/DirectoryBrowser";
import {
  findInvalidProjectRepoDraft,
  formatInvalidProjectRepoDraftMessage,
  getProjectRepoValidationIssue,
  isCompleteProjectRepoDraft,
} from "@/components/project-repo-validation";

export interface ProjectFormState {
  name: string;
  description: string;
}

export interface RepoDraft {
  id?: string;
  name: string;
  path: string;
  git_url?: string;
  notes: string;
}

const initialForm: ProjectFormState = {
  name: "",
  description: "",
};

const initialRepoDraft: RepoDraft = {
  name: "",
  path: "",
  notes: "",
};

export function useProjectFormState() {
  const [form, setForm] = useState<ProjectFormState>(initialForm);
  const [repos, setRepos] = useState<RepoDraft[]>([initialRepoDraft]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleRepoChange = useCallback((index: number, field: keyof RepoDraft, value: string) => {
    setRepos((prev) =>
      prev.map((repo, repoIndex) =>
        repoIndex === index ? { ...repo, [field]: value } : repo
      )
    );
  }, []);

  const addRepo = useCallback(() => {
    setRepos((prev) => [...prev, { ...initialRepoDraft }]);
  }, []);

  const removeRepo = useCallback((index: number) => {
    setRepos((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const resetForm = useCallback(() => {
    setForm(initialForm);
    setRepos([initialRepoDraft]);
    setFormError(null);
  }, []);

  const hydrateFromProject = useCallback((project: ProjectWithRepos) => {
    setForm({
      name: project.name || "",
      description: project.description || "",
    });

    if (project.repos && project.repos.length > 0) {
      setRepos(
        project.repos.map((repo) => ({
          id: repo.id,
          name: repo.name || "",
          path: repo.path || "",
          git_url: repo.git_url || "",
          notes: repo.notes || "",
        }))
      );
    } else {
      setRepos([initialRepoDraft]);
    }

    setFormError(null);
  }, []);

  return {
    form,
    setForm,
    repos,
    handleRepoChange,
    addRepo,
    removeRepo,
    resetForm,
    hydrateFromProject,
    isSubmitting,
    setIsSubmitting,
    formError,
    setFormError,
  };
}

export function createProjectPayload(
  form: ProjectFormState,
  repos: RepoDraft[]
) {
  const invalidRepo = findInvalidProjectRepoDraft(repos);
  if (invalidRepo) {
    throw new Error(formatInvalidProjectRepoDraftMessage(invalidRepo));
  }

  const repoPayload = repos
    .filter((repo) => isCompleteProjectRepoDraft(repo))
    .map((repo) => ({
      ...(repo.id ? { id: repo.id } : {}),
      name: repo.name.trim(),
      path: repo.path.trim(),
      ...(repo.git_url?.trim() ? { git_url: repo.git_url.trim() } : {}),
      notes: repo.notes.trim() || undefined,
    }));

  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    repos: repoPayload.length ? repoPayload : undefined,
  };
}

function ProjectFormFields({
  form,
  repos,
  isEditingProject,
  isSubmitting,
  onFieldChange,
  onRepoChange,
  onAddRepo,
  onRemoveRepo,
}: {
  form: ProjectFormState;
  repos: RepoDraft[];
  isEditingProject: boolean;
  isSubmitting: boolean;
  onFieldChange: (field: keyof ProjectFormState, value: string) => void;
  onRepoChange: (index: number, field: keyof RepoDraft, value: string) => void;
  onAddRepo: () => void;
  onRemoveRepo: (index: number) => void;
}) {
  const [expandedRepoIndexes, setExpandedRepoIndexes] = useState<number[]>([]);
  const [browsingRepoIndex, setBrowsingRepoIndex] = useState<number | null>(null);
  const previousRepoCountRef = useRef(0);

  useEffect(() => {
    if (!isEditingProject) {
      setExpandedRepoIndexes(repos.map((_, index) => index));
      previousRepoCountRef.current = repos.length;
    } else {
      setExpandedRepoIndexes([]);
      previousRepoCountRef.current = repos.length;
    }
  }, [isEditingProject, repos.length]);

  useEffect(() => {
    if (!isEditingProject) {
      previousRepoCountRef.current = repos.length;
      return;
    }

    const previousRepoCount = previousRepoCountRef.current;
    setExpandedRepoIndexes((prev) => {
      const next = prev.filter((index) => index < repos.length);
      if (repos.length > previousRepoCount) {
        next.push(
          ...Array.from(
            { length: repos.length - previousRepoCount },
            (_, offset) => previousRepoCount + offset
          )
        );
      }
      return next;
    });
    previousRepoCountRef.current = repos.length;
  }, [isEditingProject, repos.length]);

  const toggleRepoExpanded = useCallback((index: number) => {
    setExpandedRepoIndexes((prev) =>
      prev.includes(index) ? prev.filter((value) => value !== index) : [...prev, index]
    );
  }, []);

  const isRepoExpanded = useCallback(
    (index: number) => !isEditingProject || expandedRepoIndexes.includes(index),
    [expandedRepoIndexes, isEditingProject]
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4">
        <label className="space-y-1.5 block">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Project Name</span>
          <input
            value={form.name}
            onChange={(e) => onFieldChange("name", e.target.value)}
            className="input w-full"
            placeholder="e.g. AGX Cloud"
            disabled={isSubmitting}
          />
        </label>
      </div>

      <label className="space-y-1.5 block">
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Description</span>
        <textarea
          value={form.description}
          onChange={(e) => onFieldChange("description", e.target.value)}
          className="input w-full h-24 resize-none"
          placeholder="What is this project about?"
          disabled={isSubmitting}
        />
      </label>


      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--card-border)] pb-2">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
              Folders
            </h3>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
              Code repos, doc folders, design assets, config directories — any path your team needs access to.
            </p>
          </div>
          <button
            type="button"
            onClick={onAddRepo}
            className="text-xs font-semibold text-[var(--primary)] hover:underline flex-shrink-0"
            disabled={isSubmitting}
          >
            + Add Folder
          </button>
        </div>
        <div className="space-y-4">
          {repos.map((repo, index) => {
            const validationIssue = getProjectRepoValidationIssue(repo);

            return (
              <div key={index} className="p-4 rounded-2xl border border-[var(--card-border)] bg-[var(--muted)]/20 space-y-3 relative group">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-[var(--foreground)] uppercase">Folder #{index + 1}</div>
                    {isEditingProject && !isRepoExpanded(index) ? (
                      <div className="mt-1 text-sm text-[var(--muted-foreground)]">
                        <div>{repo.name || "Unnamed folder"}</div>
                        <div className="truncate">{repo.path || "No local path set"}</div>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    {isEditingProject && (
                      <button
                        type="button"
                        onClick={() => toggleRepoExpanded(index)}
                        className="text-xs font-semibold text-[var(--primary)] hover:underline"
                        disabled={isSubmitting}
                      >
                        {isRepoExpanded(index) ? "Done" : "Edit"}
                      </button>
                    )}
                    {repos.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onRemoveRepo(index)}
                        className="text-xs font-semibold text-[var(--destructive)] hover:underline"
                        disabled={isSubmitting}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                {isRepoExpanded(index) ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <input
                        value={repo.name}
                        onChange={(e) => onRepoChange(index, "name", e.target.value)}
                        placeholder="Name (e.g. Frontend, API Docs, Design System)"
                        className={`input text-sm w-full${validationIssue === "missing_name" ? " border-[var(--destructive)]/50 ring-1 ring-[var(--destructive)]/20" : ""}`}
                        disabled={isSubmitting}
                      />
                      {validationIssue === "missing_name" && (
                        <p className="text-[11px] text-[var(--destructive)]">Folder name is required</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <input
                          value={repo.path}
                          onChange={(e) => onRepoChange(index, "path", e.target.value)}
                          placeholder="Local path to folder"
                          className={`input text-sm flex-1${validationIssue === "missing_path" ? " border-[var(--destructive)]/50 ring-1 ring-[var(--destructive)]/20" : ""}`}
                          disabled={isSubmitting}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const res = await fetch("/api/filesystem/pick-folder", { method: "POST" });
                              const data = await res.json();
                              if (data.path) {
                                onRepoChange(index, "path", data.path);
                              }
                            } catch {
                              setBrowsingRepoIndex(browsingRepoIndex === index ? null : index);
                            }
                          }}
                          className="px-3 py-2 rounded-xl border border-[var(--card-border)] bg-[var(--muted)]/30 hover:bg-[var(--muted)]/60 transition-colors text-xs font-semibold text-[var(--muted-foreground)] whitespace-nowrap"
                          disabled={isSubmitting}
                        >
                          Browse
                        </button>
                      </div>
                      {validationIssue === "missing_path" && (
                        <p className="text-[11px] text-[var(--destructive)]">Local path is required</p>
                      )}
                    </div>
                    {browsingRepoIndex === index && (
                      <div className="md:col-span-2">
                        <DirectoryBrowser
                          initialPath={repo.path || ""}
                          onSelect={(selectedPath) => {
                            onRepoChange(index, "path", selectedPath);
                            setBrowsingRepoIndex(null);
                          }}
                          onCancel={() => setBrowsingRepoIndex(null)}
                        />
                      </div>
                    )}
                    <div className="md:col-span-2">
                      <textarea
                        value={repo.notes}
                        onChange={(e) => onRepoChange(index, "notes", e.target.value)}
                        placeholder="Notes for this folder — e.g. coding conventions, deploy steps, ownership, doc standards..."
                        className="input text-sm w-full min-h-24 resize-y"
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => void;
  editingProject: ProjectWithRepos | null;
  form: ProjectFormState;
  repos: RepoDraft[];
  isSubmitting: boolean;
  formError: string | null;
  onFieldChange: (field: keyof ProjectFormState, value: string) => void;
  onRepoChange: (index: number, field: keyof RepoDraft, value: string) => void;
  onAddRepo: () => void;
  onRemoveRepo: (index: number) => void;
}

export default function ProjectModal({
  isOpen,
  onClose,
  onSubmit,
  editingProject,
  form,
  repos,
  isSubmitting,
  formError,
  onFieldChange,
  onRepoChange,
  onAddRepo,
  onRemoveRepo,
}: ProjectModalProps) {
  const [projectGeneratedKnowledge, setProjectGeneratedKnowledge] = useState<Array<{ id: string; content: string; created_at?: string; source?: string }>>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadGeneratedKnowledge() {
      if (!editingProject) {
        setProjectGeneratedKnowledge([]);
        return;
      }

      try {
        const projectKnowledgeRes = await fetch(
          `/api/knowledge-notes?scope=project&subjectId=${encodeURIComponent(editingProject.id)}`
        );
        const projectKnowledgeData = projectKnowledgeRes.ok ? await projectKnowledgeRes.json() : { note: null };
        const note = projectKnowledgeData.note;

        if (!cancelled) {
          setProjectGeneratedKnowledge(
            note?.content
              ? [{
                  id: note.id,
                  content: note.content,
                  created_at: note.updatedAt ?? note.createdAt,
                  source: note.sourceType,
                }]
              : []
          );
        }
      } catch {
        if (!cancelled) {
          setProjectGeneratedKnowledge([]);
        }
      }
    }

    void loadGeneratedKnowledge();
    return () => {
      cancelled = true;
    };
  }, [editingProject]);

  const hasIncompleteRepo = Boolean(findInvalidProjectRepoDraft(repos));
  const isFormInvalid = !form.name.trim() || hasIncompleteRepo;

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop p-2 sm:p-4 z-50 overflow-y-auto flex items-center justify-center" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content w-full max-w-4xl mx-2 sm:mx-auto bg-[var(--card-bg)] rounded-3xl border border-[var(--card-border)] shadow-2xl animate-scale-in flex flex-col max-h-[90vh]">
        <div className="px-4 py-4 sm:px-8 sm:py-6 border-b border-[var(--card-border)] flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold">
              {editingProject ? "Edit Project" : "Create New Project"}
            </h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              {editingProject ? "Update your project settings and folders." : "Define a new project and connect folders."}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[var(--muted)]/50 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-8">
          {editingProject && (
            <div className="mb-6">
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--muted)]/20 p-4">
                <h3 className="text-sm font-bold uppercase tracking-widest text-[var(--muted-foreground)]">Living Project Note</h3>
                {projectGeneratedKnowledge.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {projectGeneratedKnowledge.slice(0, 5).map((item) => (
                      <div key={item.id} className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--foreground)]">
                        <div>{item.content}</div>
                        {item.created_at ? (
                          <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">{new Date(item.created_at).toLocaleString()}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-[var(--muted-foreground)]">No project note yet.</p>
                )}
              </div>
            </div>
          )}
          <ProjectFormFields
            form={form}
            repos={repos}
            isEditingProject={Boolean(editingProject)}
            isSubmitting={isSubmitting}
            onFieldChange={onFieldChange}
            onRepoChange={onRepoChange}
            onAddRepo={onAddRepo}
            onRemoveRepo={onRemoveRepo}
          />
          {formError && (
            <div className="mt-6 p-4 rounded-xl bg-[var(--destructive-muted)] border border-[var(--destructive)]/20 text-sm text-[var(--destructive)]">
              {formError}
            </div>
          )}
        </div>

        <div className="px-4 py-4 sm:px-8 sm:py-6 border-t border-[var(--card-border)] flex items-center justify-end gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-xl border border-[var(--card-border)] hover:bg-[var(--muted)]/50 transition-colors text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={isSubmitting || isFormInvalid}
            className="btn-primary px-8 py-2 shadow-lg shadow-[var(--primary)]/20 min-w-[120px]"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="spinner w-3 h-3 border-2 border-white/20 border-t-white" />
                Saving...
              </span>
            ) : (
              editingProject ? "Save Changes" : "Create Project"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
