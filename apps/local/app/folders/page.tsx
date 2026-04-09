"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Folder, FolderGit2, Pencil, Plus, Trash2, Check, X } from "lucide-react";
import Layout from "@/components/Layout";
import { Markdown } from "@/components/chat-ui/Markdown";
import DirectoryBrowser from "@/components/DirectoryBrowser";
import { useProjects, type ProjectWithRepos, type ProjectRepoInput } from "@/hooks/useProjects";

interface RepoWithProject {
  repoId: string;
  name: string;
  path: string;
  git_url?: string;
  notes: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
}

export default function FoldersPage() {
  const { projects, isLoading, refetch, updateProject } = useProjects();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingToProject, setAddingToProject] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Flatten all repos across projects
  const allRepos: RepoWithProject[] = projects.flatMap((p) =>
    (p.repos ?? []).map((r) => ({
      repoId: r.id,
      name: r.name,
      path: r.path ?? "",
      git_url: r.git_url ?? "",
      notes: r.notes ?? "",
      projectId: p.id,
      projectName: p.name,
      projectSlug: p.slug,
    }))
  );

  // Group by project — include all projects so empty ones can receive folders
  const grouped = new Map<string, { project: { id: string; name: string; slug: string }; repos: RepoWithProject[] }>();
  for (const p of projects) {
    grouped.set(p.id, {
      project: { id: p.id, name: p.name, slug: p.slug },
      repos: [],
    });
  }
  for (const repo of allRepos) {
    grouped.get(repo.projectId)!.repos.push(repo);
  }

  const startEditing = (repo: RepoWithProject) => {
    setEditingId(repo.repoId);
    setEditNotes(repo.notes);
  };

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    if (editingId && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(textareaRef.current.value.length, textareaRef.current.value.length);
      autoResize();
    }
  }, [editingId, autoResize]);

  const cancelEditing = () => {
    setEditingId(null);
    setEditNotes("");
  };

  const saveNotes = useCallback(async (repo: RepoWithProject) => {
    setSaving(true);
    try {
      const project = projects.find((p) => p.id === repo.projectId);
      if (!project) return;

      const updatedRepos: ProjectRepoInput[] = (project.repos ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        path: r.path ?? "",
        git_url: r.git_url ?? "",
        notes: r.id === repo.repoId ? editNotes : (r.notes ?? ""),
      }));

      await updateProject(repo.projectId, { repos: updatedRepos });
      setEditingId(null);
      setEditNotes("");
    } catch (err) {
      console.error("Failed to update notes:", err);
    } finally {
      setSaving(false);
    }
  }, [projects, editNotes, updateProject]);

  const handleKeyDown = (e: React.KeyboardEvent, repo: RepoWithProject) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void saveNotes(repo);
    } else if (e.key === "Escape") {
      cancelEditing();
    }
  };

  const removeFolder = useCallback(async (repo: RepoWithProject) => {
    const project = projects.find((p) => p.id === repo.projectId);
    if (!project) return;
    const updatedRepos: ProjectRepoInput[] = (project.repos ?? [])
      .filter((r) => r.id !== repo.repoId)
      .map((r) => ({ id: r.id, name: r.name, path: r.path ?? "", git_url: r.git_url ?? "", notes: r.notes ?? "" }));
    await updateProject(repo.projectId, { repos: updatedRepos });
  }, [projects, updateProject]);

  const addFolder = useCallback(async (projectId: string, path: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const name = newFolderName.trim() || path.split("/").filter(Boolean).pop() || "folder";
    const existingRepos: ProjectRepoInput[] = (project.repos ?? []).map((r) => ({
      id: r.id, name: r.name, path: r.path ?? "", git_url: r.git_url ?? "", notes: r.notes ?? "",
    }));
    await updateProject(projectId, { repos: [...existingRepos, { name, path }] });
    setAddingToProject(null);
    setNewFolderName("");
  }, [projects, newFolderName, updateProject]);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto w-full flex flex-col min-h-full">
        <header className="flex items-center gap-4 py-8">
          <Link
            href="/"
            className="p-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] hover:border-[var(--primary)] transition-all"
          >
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Folders</h1>
            <p className="text-[var(--muted-foreground)] mt-1">
              All folder paths across your projects.
            </p>
          </div>
        </header>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-4">
              <span className="spinner w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full" />
              <p className="text-sm text-[var(--muted-foreground)] animate-pulse">Loading folders...</p>
            </div>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 animate-fade-in">
            <div className="w-24 h-24 rounded-3xl bg-[var(--card-bg)] border border-[var(--card-border)] flex items-center justify-center text-4xl mb-6 shadow-xl">
              <Folder size={40} className="text-[var(--muted-foreground)]" />
            </div>
            <h2 className="text-2xl font-bold mb-2">No projects yet</h2>
            <p className="text-[var(--muted-foreground)] text-center max-w-sm mb-8 leading-relaxed">
              Create a project first, then add folders to it.
            </p>
            <Link
              href="/projects"
              className="btn-primary px-8 py-3 text-lg shadow-xl shadow-[var(--primary)]/20"
            >
              Go to Projects
            </Link>
          </div>
        ) : (
          <div className="space-y-8 pb-20">
            {Array.from(grouped.values()).map(({ project, repos }) => (
              <section key={project.id}>
                <div className="flex items-center gap-2 mb-3">
                  <Link
                    href={`/projects/${project.slug}`}
                    className="text-sm font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors uppercase tracking-wide"
                  >
                    {project.name}
                  </Link>
                </div>
                <div className="space-y-2">
                  {repos.map((repo) => {
                    const isEditing = editingId === repo.repoId;
                    return (
                      <div
                        key={repo.repoId}
                        className="group rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 transition-all hover:border-[var(--card-border-hover,var(--card-border))]"
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex-shrink-0 text-[var(--muted-foreground)]">
                            {repo.git_url ? <FolderGit2 size={16} /> : <Folder size={16} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <button
                              type="button"
                              onClick={() => void removeFolder(repo)}
                              className="float-right ml-2 p-1 rounded-md text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-400/10 transition-all"
                              aria-label="Remove folder"
                              title="Remove folder"
                            >
                              <Trash2 size={14} />
                            </button>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate">
                                {repo.name || repo.path}
                              </span>
                              {repo.name && repo.path && (
                                <span className="text-xs text-[var(--muted-foreground)] truncate font-mono">
                                  {repo.path}
                                </span>
                              )}
                            </div>
                            {repo.git_url && (
                              <p className="text-xs text-[var(--muted-foreground)] mt-0.5 font-mono truncate">
                                {repo.git_url}
                              </p>
                            )}

                            {/* Notes section */}
                            {isEditing ? (
                              <div className="mt-2">
                                <textarea
                                  ref={textareaRef}
                                  value={editNotes}
                                  onChange={(e) => { setEditNotes(e.target.value); autoResize(); }}
                                  onKeyDown={(e) => handleKeyDown(e, repo)}
                                  placeholder="What is this folder about? (Markdown supported)"
                                  rows={1}
                                  className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-sm font-mono focus:border-[var(--primary)] focus:outline-none resize-none overflow-hidden"
                                />
                                <div className="flex items-center gap-2 mt-1.5">
                                  <button
                                    onClick={() => void saveNotes(repo)}
                                    disabled={saving}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                                  >
                                    <Check size={12} />
                                    {saving ? "Saving..." : "Save"}
                                  </button>
                                  <button
                                    onClick={cancelEditing}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                                  >
                                    <X size={12} />
                                    Cancel
                                  </button>
                                  <span className="text-[10px] text-[var(--muted-foreground)] ml-auto">
                                    Cmd+Enter to save
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div
                                className="group/notes mt-1 cursor-pointer"
                                onClick={() => startEditing(repo)}
                              >
                                {repo.notes ? (
                                  <div className="text-sm text-[var(--muted-foreground)] leading-relaxed relative">
                                    <Markdown content={repo.notes} />
                                    <Pencil
                                      size={11}
                                      className="absolute top-0 right-0 opacity-0 group-hover/notes:opacity-60 transition-opacity"
                                    />
                                  </div>
                                ) : (
                                  <p className="text-xs text-[var(--muted-foreground)] opacity-0 group-hover:opacity-60 transition-opacity italic">
                                    Click to add notes...
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {addingToProject === project.id ? (
                    <div className="mt-3 space-y-2">
                      <input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder="Folder name (optional)"
                        className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none"
                      />
                      <DirectoryBrowser
                        initialPath=""
                        onSelect={(path) => void addFolder(project.id, path)}
                        onCancel={() => { setAddingToProject(null); setNewFolderName(""); }}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAddingToProject(project.id)}
                      className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                    >
                      <Plus size={14} />
                      Add folder
                    </button>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
