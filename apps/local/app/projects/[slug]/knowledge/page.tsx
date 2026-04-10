"use client";

import { useState, useEffect, use } from "react";
import { Markdown } from "@/components/chat-ui/Markdown";
import {
  BrainCircuit,
  FileText,
  FolderGit2,
  Plus,
  Search,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { useProjects, type ProjectRepoInput } from "@/hooks/useProjects";
import { useProjectSkills } from "@/hooks/useProjectResources";

type KnowledgeTab = "project" | "repos";

type SystemNote = {
  id: string;
  content: string;
  created_at?: string;
  updated_at?: string;
  source?: string;
};

function mapKnowledgeNoteToSystemNote(note: {
  id: string;
  content: string;
  createdAt?: string;
  updatedAt?: string;
  sourceType?: string;
} | null | undefined): SystemNote | null {
  if (!note) return null;
  return {
    id: note.id,
    content: note.content,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
    source: note.sourceType,
  };
}

export default function ProjectKnowledgePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  const { projects, updateProject } = useProjects();
  const currentProject = projects.find((project) => project.slug === slug);
  const projectId = currentProject?.id ?? null;

  const { skills: projectSkills, addSkill, removeSkill } = useProjectSkills(projectId);

  const [activeTab, setActiveTab] = useState<KnowledgeTab>("project");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddReference, setShowAddReference] = useState(false);
  const [newKnowledgeFile, setNewKnowledgeFile] = useState("");
  const [newKnowledgeCondition, setNewKnowledgeCondition] = useState("");
  const [projectSystemNote, setProjectSystemNote] = useState<SystemNote | null>(null);
  const [repoSystemNotes, setRepoSystemNotes] = useState<Record<string, SystemNote | null>>({});
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderPath, setNewFolderPath] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [editingFolderPath, setEditingFolderPath] = useState("");
  const [folderStatus, setFolderStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadProjectSystemNote() {
      if (!projectId) {
        setProjectSystemNote(null);
        return;
      }
      try {
        const res = await fetch(`/api/knowledge-notes?scope=project&subjectId=${encodeURIComponent(projectId)}`);
        const data = res.ok ? await res.json() : { note: null };
        if (!cancelled) {
          setProjectSystemNote(mapKnowledgeNoteToSystemNote(data.note));
        }
      } catch {
        if (!cancelled) setProjectSystemNote(null);
      }
    }
    void loadProjectSystemNote();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    async function loadRepoSystemNotes() {
      const repos = currentProject?.repos ?? [];
      if (repos.length === 0) {
        setRepoSystemNotes({});
        return;
      }
      try {
        const entries = await Promise.all(
          repos.map(async (repo) => {
            const res = await fetch(`/api/knowledge-notes?scope=repo&subjectId=${encodeURIComponent(repo.id)}`);
            const data = res.ok ? await res.json() : { note: null };
            return [repo.id, mapKnowledgeNoteToSystemNote(data.note)] as const;
          })
        );
        if (!cancelled) {
          setRepoSystemNotes(Object.fromEntries(entries));
        }
      } catch {
        if (!cancelled) setRepoSystemNotes({});
      }
    }
    void loadRepoSystemNotes();
    return () => {
      cancelled = true;
    };
  }, [currentProject?.repos]);

  const filteredSkills = projectSkills.filter(
    (skill) =>
      !searchQuery ||
      skill.file.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (skill.condition ?? "").toLowerCase().includes(searchQuery.toLowerCase())
  );
  const projectNoteMatches =
    !searchQuery || projectSystemNote?.content.toLowerCase().includes(searchQuery.toLowerCase());
  const filteredRepos = (currentProject?.repos ?? []).filter((repo) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const systemNote = (repoSystemNotes[repo.id]?.content ?? "").toLowerCase();
    return (
      repo.name.toLowerCase().includes(query) ||
      (repo.path ?? "").toLowerCase().includes(query) ||
      systemNote.includes(query)
    );
  });

  const setFolderFeedback = (message: string) => {
    setFolderStatus(message);
    window.setTimeout(() => setFolderStatus(null), 2500);
  };

  const toRepoInputs = () =>
    (currentProject?.repos ?? []).map((repo) => ({
      id: repo.id,
      name: repo.name,
      path: repo.path,
      git_url: repo.git_url,
      notes: repo.notes,
    })) satisfies ProjectRepoInput[];

  const handleAddFolder = async () => {
    const name = newFolderName.trim();
    const path = newFolderPath.trim();
    if (!currentProject || !name || !path) return;

    try {
      await updateProject(currentProject.id, {
        repos: [...toRepoInputs(), { name, path }],
      });
      setIsAddingFolder(false);
      setNewFolderName("");
      setNewFolderPath("");
      setFolderFeedback("Folder added");
    } catch {
      setFolderFeedback("Failed to add folder");
    }
  };

  const handleDeleteFolder = async (repoId: string) => {
    if (!currentProject) return;
    try {
      await updateProject(currentProject.id, {
        repos: toRepoInputs().filter((repo) => repo.id !== repoId),
      });
      if (editingFolderId === repoId) {
        setEditingFolderId(null);
        setEditingFolderName("");
        setEditingFolderPath("");
      }
      setFolderFeedback("Folder deleted");
    } catch {
      setFolderFeedback("Failed to delete folder");
    }
  };

  const startEditingFolder = (repo: NonNullable<typeof currentProject>["repos"][number]) => {
    setEditingFolderId(repo.id);
    setEditingFolderName(repo.name);
    setEditingFolderPath(repo.path ?? "");
  };

  const handleSaveFolder = async (repoId: string) => {
    const name = editingFolderName.trim();
    const path = editingFolderPath.trim();
    if (!currentProject || !name || !path) return;

    try {
      await updateProject(currentProject.id, {
        repos: toRepoInputs().map((repo) =>
          repo.id === repoId ? { ...repo, name, path } : repo
        ),
      });
      setEditingFolderId(null);
      setEditingFolderName("");
      setEditingFolderPath("");
      setFolderFeedback("Folder updated");
    } catch {
      setFolderFeedback("Failed to update folder");
    }
  };

  if (!currentProject) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-shrink-0 border-b border-[var(--border)] bg-[var(--card-bg)] px-3 py-2 backdrop-blur-md sm:h-14 sm:px-6 sm:py-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold text-[var(--foreground)]">{currentProject.name}</span>
            <span className="text-[var(--muted-foreground)]">/</span>
            <span className="text-[var(--muted-foreground)]">Knowledge</span>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-shell-soft-text)]" size={14} />
            <input
              type="text"
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full rounded-full border border-[var(--border)] bg-[var(--secondary)] py-1.5 pl-9 pr-4 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-[var(--primary)]"
            />
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 px-3 pb-2 pt-4 sm:px-6">
        <div className="flex w-fit gap-1 rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-1">
          <TabButton
            active={activeTab === "project"}
            onClick={() => setActiveTab("project")}
            icon={<BrainCircuit size={14} />}
            label="Project"
          />
          <TabButton
            active={activeTab === "repos"}
            onClick={() => setActiveTab("repos")}
            icon={<FolderGit2 size={14} />}
            label="Folders"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-8 sm:px-6">
        {activeTab === "project" ? (
          <div className="mt-2 grid grid-cols-12 gap-4 sm:gap-6">
            <div className="col-span-12 lg:col-span-4 space-y-4">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-5 shadow-[var(--shadow-sm)]">
                <h3 className="mb-4 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--app-shell-soft-text)]">
                  Overview
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="References" value={filteredSkills.length} sub="File-backed" />
                  <StatCard label="Folders" value={currentProject.repos.length} sub="Attached folders" />
                </div>
                <div className="mt-3">
                  <StatCard label="System Note" value={projectSystemNote?.content ? 1 : 0} sub="Living doc" />
                </div>
              </div>

              <section className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-5 shadow-[var(--shadow-sm)]">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                      <FolderGit2 size={16} className="text-[var(--primary)]" />
                      Folders
                    </h2>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      Add, edit, or remove project folders from the overview.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingFolder((value) => !value);
                      setEditingFolderId(null);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                </div>

                {folderStatus ? (
                  <p className="mb-3 text-xs text-[var(--muted-foreground)]">{folderStatus}</p>
                ) : null}

                {isAddingFolder ? (
                  <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3">
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={newFolderName}
                        onChange={(event) => setNewFolderName(event.target.value)}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--card-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                        placeholder="Folder name"
                      />
                      <input
                        type="text"
                        value={newFolderPath}
                        onChange={(event) => setNewFolderPath(event.target.value)}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--card-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                        placeholder="Local path"
                      />
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleAddFolder()}
                        disabled={!newFolderName.trim() || !newFolderPath.trim()}
                        className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingFolder(false);
                          setNewFolderName("");
                          setNewFolderPath("");
                        }}
                        className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--secondary)]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                {(currentProject.repos ?? []).length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">No folders linked yet.</p>
                ) : (
                  <div className="space-y-2">
                    {currentProject.repos.map((repo) => {
                      const isEditing = editingFolderId === repo.id;
                      return (
                        <div
                          key={repo.id}
                          className="rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3"
                        >
                          {isEditing ? (
                            <>
                              <div className="space-y-2">
                                <input
                                  type="text"
                                  value={editingFolderName}
                                  onChange={(event) => setEditingFolderName(event.target.value)}
                                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                                  placeholder="Folder name"
                                />
                                <input
                                  type="text"
                                  value={editingFolderPath}
                                  onChange={(event) => setEditingFolderPath(event.target.value)}
                                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                                  placeholder="Local path"
                                />
                              </div>
                              <div className="mt-3 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void handleSaveFolder(repo.id)}
                                  disabled={!editingFolderName.trim() || !editingFolderPath.trim()}
                                  className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingFolderId(null);
                                    setEditingFolderName("");
                                    setEditingFolderPath("");
                                  }}
                                  className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--card-bg)]"
                                >
                                  Cancel
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-[var(--foreground)]">{repo.name}</p>
                                <p className="truncate text-xs text-[var(--muted-foreground)]">
                                  {repo.path || repo.git_url || "No path set"}
                                </p>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => startEditingFolder(repo)}
                                  className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
                                  aria-label={`Edit ${repo.name}`}
                                >
                                  <SquarePen className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteFolder(repo.id)}
                                  className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-red-500"
                                  aria-label={`Delete ${repo.name}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            <div className="col-span-12 lg:col-span-8 space-y-4">
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-5 shadow-[var(--shadow-sm)]">
                <div className="mb-4">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                    <BrainCircuit size={16} className="text-[var(--primary)]" />
                    Living Project Note
                  </h2>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    Auto-maintained project knowledge. It updates in place instead of creating review candidates.
                  </p>
                </div>
                <SystemNoteCard
                  note={
                    projectNoteMatches
                      ? projectSystemNote
                      : projectSystemNote?.content
                        ? { ...projectSystemNote, content: "" }
                        : null
                  }
                  emptyLabel={searchQuery ? "No matching project note content." : "No project note yet."}
                  scope="project"
                  subjectId={projectId ?? ""}
                  onSaved={setProjectSystemNote}
                />
              </section>

              <section className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-5 shadow-[var(--shadow-sm)]">
                <div className="mb-4">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                    <FileText size={16} className="text-[var(--primary)]" />
                    Project References
                  </h2>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    File-backed project knowledge for project-specific instructions.
                  </p>
                </div>

                {filteredSkills.length > 0 && (
                  <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-2">
                    {filteredSkills.map((skill) => (
                      <div
                        key={skill.id}
                        className="group flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3"
                      >
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--primary-muted)]">
                          <FileText size={14} className="text-[var(--primary)]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate break-all font-mono text-xs text-[var(--secondary-foreground)]">
                            {skill.file}
                          </div>
                          {skill.condition && (
                            <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">{skill.condition}</div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => void removeSkill(skill.id)}
                          className="rounded-lg p-1.5 text-[var(--app-shell-soft-text)] opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--card-bg)] hover:text-red-500"
                          aria-label="Remove reference"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {showAddReference ? (
                  <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3">
                    <input
                      type="text"
                      value={newKnowledgeFile}
                      onChange={(event) => setNewKnowledgeFile(event.target.value)}
                      placeholder="path/to/project-knowledge.md"
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--card-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-[var(--primary)]"
                      autoFocus
                    />
                    <input
                      type="text"
                      value={newKnowledgeCondition}
                      onChange={(event) => setNewKnowledgeCondition(event.target.value)}
                      placeholder="Optional condition"
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--card-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-[var(--primary)]"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddReference(false);
                          setNewKnowledgeFile("");
                          setNewKnowledgeCondition("");
                        }}
                        className="px-3 py-1.5 text-xs text-[var(--muted-foreground)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const file = newKnowledgeFile.trim();
                          if (!file) return;
                          await addSkill(file, newKnowledgeCondition.trim() || undefined);
                          setNewKnowledgeFile("");
                          setNewKnowledgeCondition("");
                          setShowAddReference(false);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)]"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAddReference(true)}
                    className="group flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] py-3 text-sm text-[var(--muted-foreground)] transition-all hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                  >
                    <Plus size={16} className="transition-transform group-hover:scale-110" />
                    Add Reference
                  </button>
                )}
              </section>
            </div>
          </div>
        ) : (
          <div className="mt-2 space-y-4">
            {filteredRepos.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] px-6 py-12 text-center">
                <FolderGit2 size={32} className="mx-auto mb-3 text-[var(--app-shell-soft-text)]" />
                <p className="text-sm text-[var(--muted-foreground)]">
                  {currentProject.repos.length === 0 ? "This project has no folders attached yet." : "No matching folders."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {filteredRepos.map((repo) => (
                  <RepoCard
                    key={repo.id}
                    repo={repo}
                    systemNote={repoSystemNotes[repo.id] ?? null}
                    systemNoteMatches={!searchQuery || (repoSystemNotes[repo.id]?.content ?? "").toLowerCase().includes(searchQuery.toLowerCase())}
                    onSystemNoteSaved={(note) => setRepoSystemNotes((prev) => ({ ...prev, [repo.id]: note }))}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs font-semibold transition-all ${
        active
          ? "bg-[var(--card-bg)] text-[var(--foreground)] shadow-[var(--shadow-sm)] ring-1 ring-[var(--border)]"
          : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4">
      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--app-shell-soft-text)]">
        {label}
      </span>
      <span className="mt-1 text-2xl font-bold text-[var(--foreground)]">{value}</span>
      <span className="mt-1 text-[10px] text-[var(--app-shell-soft-text)]">{sub}</span>
    </div>
  );
}

function SystemNoteCard({
  note,
  emptyLabel,
  scope,
  subjectId,
  onSaved,
}: {
  note: SystemNote | null;
  emptyLabel: string;
  scope: "project" | "repo";
  subjectId: string;
  onSaved: (note: SystemNote | null) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(note?.content ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(note?.content ?? "");
  }, [note?.id, note?.content]);

  const hasContent = Boolean(note?.content.trim());
  const updatedAt = note?.updated_at ?? note?.created_at;
  const summary = note?.source;

  async function handleSave() {
    if (!subjectId) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/knowledge-notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          subjectId,
          content: draft,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to save knowledge note");
      }
      const nextNote = mapKnowledgeNoteToSystemNote(data.note);
      onSaved(nextNote);
      setDraft(nextNote?.content ?? "");
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save knowledge note");
    } finally {
      setIsSaving(false);
    }
  }

  if (!hasContent) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--muted-foreground)]">
        <div className="flex items-center justify-between gap-3">
          <span>{emptyLabel}</span>
          <button
            type="button"
            onClick={() => {
              setDraft(note?.content ?? "");
              setError(null);
              setIsEditing(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)]"
          >
            <SquarePen className="h-3.5 w-3.5" />
            Edit
          </button>
        </div>
        {isEditing ? (
          <div className="mt-4 space-y-3">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={10}
              className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              placeholder="Write the living knowledge note in markdown..."
            />
            {error ? <p className="text-xs text-red-500">{error}</p> : null}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraft(note?.content ?? "");
                  setError(null);
                  setIsEditing(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)]"
                disabled={isSaving}
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--app-shell-soft-text)]">
          {updatedAt ? <span>Updated {new Date(updatedAt).toLocaleString()}</span> : null}
          {summary ? <span>{summary}</span> : null}
        </div>
        {!isEditing ? (
          <button
            type="button"
            onClick={() => {
              setDraft(note?.content ?? "");
              setError(null);
              setIsEditing(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)]"
          >
            <SquarePen className="h-3.5 w-3.5" />
            Edit
          </button>
        ) : null}
      </div>
      {isEditing ? (
        <div className="space-y-3">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={12}
            className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--card-bg)] px-4 py-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            placeholder="Write the living knowledge note in markdown..."
          />
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(note?.content ?? "");
                setError(null);
                setIsEditing(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)]"
              disabled={isSaving}
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <div className="text-sm leading-relaxed text-[var(--secondary-foreground)]">
          <Markdown content={note?.content ?? ""} />
        </div>
      )}
    </div>
  );
}

function RepoCard({
  repo,
  systemNote,
  systemNoteMatches,
  onSystemNoteSaved,
}: {
  repo: { id: string; name: string; path?: string; notes?: string };
  systemNote: SystemNote | null;
  systemNoteMatches: boolean;
  onSystemNoteSaved: (note: SystemNote | null) => void;
}) {
  return (
    <div className="group flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-5 shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--card-hover-border)]">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--secondary)] text-[var(--muted-foreground)]">
            <FolderGit2 size={20} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">{repo.name}</h3>
            <p className="text-[11px] text-[var(--muted-foreground)]">{repo.path || "No path set"}</p>
          </div>
        </div>
      </div>

      <div className="mb-3">
        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--app-shell-soft-text)]">
          Living Repo Note
        </p>
        <SystemNoteCard
          note={
            systemNoteMatches
              ? systemNote
              : systemNote?.content
                ? { ...systemNote, content: "" }
                : null
          }
          emptyLabel="No repo note yet."
          scope="repo"
          subjectId={repo.id}
          onSaved={onSystemNoteSaved}
        />
      </div>
    </div>
  );
}
