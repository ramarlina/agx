"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Settings,
  FolderGit2,
  Download,
  Upload,
  Trash2,
  AlertTriangle,
  Plus,
  X,
} from "lucide-react";
import type { ProjectWithAgents, ProjectRepoInput } from "@/hooks/useProjects";

interface ProjectSettingsProps {
  project: ProjectWithAgents;
  onUpdate: (projectId: string, payload: Record<string, unknown>) => Promise<unknown>;
  onDelete: (projectId: string) => Promise<unknown>;
}

export function ProjectSettings({ project, onUpdate, onDelete }: ProjectSettingsProps) {
  const router = useRouter();

  // --- Project Info ---
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [infoStatus, setInfoStatus] = useState<string | null>(null);

  const saveField = useCallback(
    async (field: "name" | "description", value: string) => {
      const trimmed = value.trim();
      if (field === "name" && !trimmed) return;
      if (
        (field === "name" && trimmed === project.name) ||
        (field === "description" && trimmed === (project.description ?? ""))
      ) {
        return;
      }
      try {
        await onUpdate(project.id, { [field]: trimmed });
        setInfoStatus("Saved");
        setTimeout(() => setInfoStatus(null), 2000);
      } catch {
        setInfoStatus("Failed to save");
        setTimeout(() => setInfoStatus(null), 3000);
      }
    },
    [onUpdate, project.id, project.name, project.description],
  );

  // --- Repositories ---
  const [addingRepo, setAddingRepo] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoPath, setNewRepoPath] = useState("");
  const [repoStatus, setRepoStatus] = useState<string | null>(null);

  const saveRepos = useCallback(
    async (repos: ProjectRepoInput[]) => {
      try {
        await onUpdate(project.id, { repos });
        setRepoStatus("Saved");
        setTimeout(() => setRepoStatus(null), 2000);
      } catch {
        setRepoStatus("Failed to save");
        setTimeout(() => setRepoStatus(null), 3000);
      }
    },
    [onUpdate, project.id],
  );

  const handleAddRepo = useCallback(async () => {
    const trimmedName = newRepoName.trim();
    const trimmedPath = newRepoPath.trim();
    if (!trimmedName || !trimmedPath) return;

    const existing: ProjectRepoInput[] = (project.repos ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path,
      git_url: r.git_url,
      notes: r.notes,
    }));

    await saveRepos([...existing, { name: trimmedName, path: trimmedPath }]);
    setNewRepoName("");
    setNewRepoPath("");
    setAddingRepo(false);
  }, [newRepoName, newRepoPath, project.repos, saveRepos]);

  const handleRemoveRepo = useCallback(
    async (repoId: string) => {
      const remaining: ProjectRepoInput[] = (project.repos ?? [])
        .filter((r) => r.id !== repoId)
        .map((r) => ({
          id: r.id,
          name: r.name,
          path: r.path,
          git_url: r.git_url,
          notes: r.notes,
        }));
      await saveRepos(remaining);
    },
    [project.repos, saveRepos],
  );

  // --- Team Config ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [teamStatus, setTeamStatus] = useState<string | null>(null);

  const handleExportYaml = useCallback(() => {
    window.open(`/api/projects/${project.id}/teams/export`, "_blank");
  }, [project.id]);

  const handleImportYaml = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const content = await file.text();
        const res = await fetch(`/api/projects/${project.id}/teams/import`, {
          method: "POST",
          headers: { "Content-Type": "application/x-yaml" },
          body: content,
        });

        if (res.ok) {
          setTeamStatus("Import successful");
        } else {
          const body = await res.json().catch(() => ({}));
          setTeamStatus(`Import failed: ${body.error || res.statusText}`);
        }
      } catch {
        setTeamStatus("Import failed");
      }

      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTimeout(() => setTeamStatus(null), 4000);
    },
    [project.id],
  );

  // --- Danger Zone ---
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await onDelete(project.id);
      router.push("/");
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [onDelete, project.id, router]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-zinc-400" />
          <h1 className="text-xl font-bold text-zinc-100">Project Settings</h1>
        </div>

        {/* Section 1: Project Info */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
              Project Info
            </h2>
            {infoStatus && (
              <span className="text-xs text-zinc-500">{infoStatus}</span>
            )}
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-500">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => saveField("name", name)}
              className="input w-full"
              placeholder="Project name"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-500">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => saveField("description", description)}
              className="input w-full h-24 resize-none"
              placeholder="What is this project about?"
            />
          </label>
        </section>

        {/* Section 2: Repositories */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <FolderGit2 className="w-4 h-4 text-zinc-400" />
              <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
                Repositories
              </h2>
            </div>
            <div className="flex items-center gap-3">
              {repoStatus && (
                <span className="text-xs text-zinc-500">{repoStatus}</span>
              )}
              <button
                onClick={() => setAddingRepo(true)}
                className="text-xs font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                Add Repository
              </button>
            </div>
          </div>

          {(project.repos ?? []).length === 0 && !addingRepo && (
            <p className="text-sm text-zinc-500">No repositories linked to this project.</p>
          )}

          <div className="space-y-2">
            {(project.repos ?? []).map((repo) => (
              <div
                key={repo.id}
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/30 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-200 truncate">
                    {repo.name}
                  </div>
                  <div className="text-xs text-zinc-500 truncate">
                    {repo.path || repo.git_url || "No path set"}
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveRepo(repo.id)}
                  className="ml-3 p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors flex-shrink-0"
                  title="Remove repository"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {addingRepo && (
            <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-4 space-y-3">
              <input
                value={newRepoName}
                onChange={(e) => setNewRepoName(e.target.value)}
                className="input w-full text-sm"
                placeholder="Repository name"
                autoFocus
              />
              <input
                value={newRepoPath}
                onChange={(e) => setNewRepoPath(e.target.value)}
                className="input w-full text-sm"
                placeholder="Local path (e.g. /Users/you/projects/repo)"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAddRepo}
                  disabled={!newRepoName.trim() || !newRepoPath.trim()}
                  className="btn-primary px-4 py-1.5 text-sm disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setAddingRepo(false);
                    setNewRepoName("");
                    setNewRepoPath("");
                  }}
                  className="px-4 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Section 3: Team Config */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">
              Team Config
            </h2>
            {teamStatus && (
              <span className="text-xs text-zinc-500">{teamStatus}</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleExportYaml}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 transition-colors text-sm text-zinc-300"
            >
              <Download className="w-4 h-4" />
              Export YAML
            </button>

            <label className="flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 transition-colors text-sm text-zinc-300 cursor-pointer">
              <Upload className="w-4 h-4" />
              Import YAML
              <input
                ref={fileInputRef}
                type="file"
                accept=".yaml,.yml"
                onChange={handleImportYaml}
                className="hidden"
              />
            </label>
          </div>
        </section>

        {/* Section 4: Danger Zone */}
        <section className="rounded-2xl border border-red-900/50 bg-zinc-900/50 p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-red-900/30 pb-3">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-red-400">
              Danger Zone
            </h2>
          </div>

          <p className="text-sm text-zinc-400">
            Deleting this project will remove all associated data including repositories, agent assignments, and threads.
          </p>

          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-900/50 bg-red-950/30 hover:bg-red-950/50 transition-colors text-sm text-red-400"
            >
              <Trash2 className="w-4 h-4" />
              Delete Project
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 transition-colors text-sm text-white font-medium disabled:opacity-50"
              >
                {deleting ? (
                  <>
                    <span className="spinner w-3 h-3 border-2 border-white/20 border-t-white" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Confirm Delete
                  </>
                )}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
