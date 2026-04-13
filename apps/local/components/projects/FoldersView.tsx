"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
  FileText,
  FolderGit2,
  FolderOpen,
  FolderSearch,
  GitBranch,
  HardDrive,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useProjectsWithAgents, type ProjectRepoInput, type ProjectRepo } from "@/hooks/useProjects";
import DirectoryBrowser from "@/components/DirectoryBrowser";

interface FoldersViewProps {
  projectId: string;
}

type SystemNote = {
  id: string;
  content: string;
  created_at?: string;
  updated_at?: string;
};

interface RepoAnalysis {
  isGit: boolean;
  branch?: string;
  status?: { modified: number; untracked: number; staged: number };
  languages: Record<string, number>;
}

function mapNote(note: { id: string; content: string; createdAt?: string; updatedAt?: string } | null | undefined): SystemNote | null {
  if (!note) return null;
  return { id: note.id, content: note.content, created_at: note.createdAt, updated_at: note.updatedAt };
}

function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(path);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="p-1 rounded text-zinc-600 hover:text-zinc-300 transition-colors"
      title="Copy path"
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function LanguageBadge({ lang, count }: { lang: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800 text-xs text-zinc-400">
      {lang}
      <span className="text-zinc-600">{count}</span>
    </span>
  );
}

function AnalysisSummary({ analysis }: { analysis: RepoAnalysis }) {
  const topLangs = Object.entries(analysis.languages)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800/50">
        <HardDrive className="w-3.5 h-3.5 text-zinc-500" />
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Analysis</span>
      </div>
      <div className="px-4 py-3 space-y-3">
        {/* Git info */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5 text-zinc-500" />
            {analysis.isGit ? (
              <span className="text-xs text-zinc-300">
                {analysis.branch ?? "detached"}
              </span>
            ) : (
              <span className="text-xs text-zinc-500 italic">Not a git repo</span>
            )}
          </div>
          {analysis.isGit && analysis.status && (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              {analysis.status.staged > 0 && (
                <span className="text-green-400/70">{analysis.status.staged} staged</span>
              )}
              {analysis.status.modified > 0 && (
                <span className="text-yellow-400/70">{analysis.status.modified} modified</span>
              )}
              {analysis.status.untracked > 0 && (
                <span className="text-zinc-500">{analysis.status.untracked} untracked</span>
              )}
              {analysis.status.staged === 0 && analysis.status.modified === 0 && analysis.status.untracked === 0 && (
                <span className="text-zinc-600">clean</span>
              )}
            </div>
          )}
        </div>

        {/* Languages */}
        {topLangs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {topLangs.map(([lang, count]) => (
              <LanguageBadge key={lang} lang={lang} count={count} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FolderRow({
  repo,
  isSelected,
  onSelect,
}: {
  repo: ProjectRepo;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group ${
        isSelected
          ? "bg-blue-500/10 border border-blue-500/20"
          : "hover:bg-zinc-800/50 border border-transparent"
      }`}
    >
      {isSelected ? (
        <FolderOpen className="w-4 h-4 text-blue-400 flex-shrink-0" />
      ) : (
        <FolderGit2 className="w-4 h-4 text-zinc-500 flex-shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-medium truncate ${isSelected ? "text-blue-300" : "text-zinc-200"}`}>
          {repo.name}
        </div>
        <div className="text-xs text-zinc-500 truncate">
          {repo.path || repo.git_url || "No path set"}
        </div>
      </div>
      <ChevronRight
        className={`w-3.5 h-3.5 flex-shrink-0 transition-colors ${
          isSelected ? "text-blue-400" : "text-zinc-700 group-hover:text-zinc-500"
        }`}
      />
    </button>
  );
}

function FolderDetail({
  repo,
  systemNote,
  analysis,
  analysisLoading,
  onNoteSave,
  noteSaving,
  onEdit,
  onDelete,
}: {
  repo: ProjectRepo;
  systemNote: SystemNote | null;
  analysis: RepoAnalysis | null;
  analysisLoading: boolean;
  onNoteSave: (repoId: string, content: string) => Promise<void>;
  noteSaving: boolean;
  onEdit: (repo: ProjectRepo) => void;
  onDelete: (repoId: string) => void;
}) {
  const [notes, setNotes] = useState(repo.notes ?? "");
  const [editingNotes, setEditingNotes] = useState(false);
  const [localNotes, setLocalNotes] = useState(notes);

  useEffect(() => {
    setNotes(repo.notes ?? "");
    setLocalNotes(repo.notes ?? "");
    setEditingNotes(false);
  }, [repo.id, repo.notes]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <FolderOpen className="w-5 h-5 text-blue-400 flex-shrink-0" />
            <h3 className="text-lg font-semibold text-zinc-100 truncate">{repo.name}</h3>
          </div>
          {repo.path && (
            <div className="flex items-center gap-1.5 ml-7">
              <code className="text-xs text-zinc-500 font-mono truncate">{repo.path}</code>
              <CopyPathButton path={repo.path} />
            </div>
          )}
          {repo.git_url && (
            <div className="flex items-center gap-1.5 ml-7 mt-1">
              <ExternalLink className="w-3 h-3 text-zinc-600 flex-shrink-0" />
              <a
                href={repo.git_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400/70 hover:text-blue-400 truncate"
              >
                {repo.git_url}
              </a>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={() => onEdit(repo)}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            title="Edit folder"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(repo.id)}
            className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors"
            title="Delete folder"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Analysis */}
      {analysisLoading && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 px-4 py-3">
          <span className="text-xs text-zinc-600 animate-pulse">Analyzing folder...</span>
        </div>
      )}
      {!analysisLoading && analysis && <AnalysisSummary analysis={analysis} />}

      {/* Notes section */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/50">
          <div className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Notes</span>
          </div>
          {!editingNotes ? (
            <button
              type="button"
              onClick={() => {
                setLocalNotes(notes);
                setEditingNotes(true);
              }}
              className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-600">Cmd+Enter to save</span>
              <button
                type="button"
                onClick={() => {
                  setEditingNotes(false);
                  setLocalNotes(notes);
                }}
                className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors"
              >
                <X className="w-3 h-3" />
                Cancel
              </button>
              <button
                type="button"
                disabled={noteSaving}
                onClick={async () => {
                  await onNoteSave(repo.id, localNotes);
                  setNotes(localNotes);
                  setEditingNotes(false);
                }}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                <Save className="w-3 h-3" />
                Save
              </button>
            </div>
          )}
        </div>
        <div className="px-4 py-3 min-h-[80px]">
          {editingNotes ? (
            <textarea
              value={localNotes}
              onChange={(e) => setLocalNotes(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void (async () => {
                    await onNoteSave(repo.id, localNotes);
                    setNotes(localNotes);
                    setEditingNotes(false);
                  })();
                } else if (e.key === "Escape") {
                  setEditingNotes(false);
                  setLocalNotes(notes);
                }
              }}
              className="w-full bg-transparent text-sm text-zinc-300 resize-none outline-none min-h-[120px] placeholder:text-zinc-600"
              placeholder="Add notes about this folder... (architecture, conventions, important files, etc.)"
              autoFocus
            />
          ) : notes ? (
            <p className="text-sm text-zinc-300 whitespace-pre-wrap">{notes}</p>
          ) : (
            <p className="text-sm text-zinc-600 italic">No notes yet. Click edit to describe this folder.</p>
          )}
        </div>
      </div>

      {/* System-generated knowledge */}
      {systemNote && (
        <div className="rounded-xl border border-zinc-800/50 bg-zinc-950/30 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Generated Knowledge
            </span>
            {systemNote.updated_at && (
              <span className="text-xs text-zinc-600 ml-auto">
                {new Date(systemNote.updated_at).toLocaleDateString()}
              </span>
            )}
          </div>
          <div className="px-4 py-3 text-sm text-zinc-400 whitespace-pre-wrap leading-relaxed">
            {systemNote.content}
          </div>
        </div>
      )}
    </div>
  );
}

/** Add-folder flow: name input + directory browser + native picker option */
function AddFolderPanel({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, path: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickingNative, setPickingNative] = useState(false);
  const [analysis, setAnalysis] = useState<RepoAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const analyzePath = useCallback(async (dirPath: string) => {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/filesystem/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dirPath }),
      });
      if (res.ok) {
        const data = await res.json();
        setAnalysis(data.analysis);
      }
    } catch { /* ignore */ }
    setAnalyzing(false);
  }, []);

  const handleSelectPath = useCallback((path: string) => {
    setSelectedPath(path);
    // Auto-fill name from last path segment if empty
    if (!name.trim()) {
      const segment = path.split("/").filter(Boolean).pop() ?? "";
      setName(segment);
    }
    void analyzePath(path);
  }, [name, analyzePath]);

  const handleNativePick = useCallback(async () => {
    setPickingNative(true);
    try {
      const res = await fetch("/api/filesystem/pick-folder", { method: "POST" });
      const data = await res.json();
      if (data.path) {
        handleSelectPath(data.path);
      }
    } catch { /* ignore */ }
    setPickingNative(false);
  }, [handleSelectPath]);

  const handleSave = useCallback(async () => {
    if (!selectedPath || !name.trim()) return;
    setSaving(true);
    try {
      await onAdd(name.trim(), selectedPath);
    } finally {
      setSaving(false);
    }
  }, [name, selectedPath, onAdd]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-300">Add Folder</h3>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Name input */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-500">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input w-full text-sm"
          placeholder="Auto-detected from path"
        />
      </div>

      {/* Selected path preview */}
      {selectedPath && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <code className="text-xs text-blue-300 font-mono truncate flex-1">{selectedPath}</code>
          <button
            type="button"
            onClick={() => { setSelectedPath(null); setAnalysis(null); }}
            className="p-0.5 rounded text-blue-400/50 hover:text-blue-300 transition-colors flex-shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Analysis preview */}
      {analyzing && (
        <div className="text-xs text-zinc-600 animate-pulse px-1">Analyzing...</div>
      )}
      {!analyzing && analysis && <AnalysisSummary analysis={analysis} />}

      {/* Directory browser or native picker */}
      {!selectedPath && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-zinc-500">Choose a folder</span>
            <button
              type="button"
              onClick={() => void handleNativePick()}
              disabled={pickingNative}
              className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-400 border border-zinc-700 hover:border-zinc-600 hover:text-zinc-300 bg-zinc-800/50 transition-colors disabled:opacity-50"
            >
              <FolderSearch className="w-3 h-3" />
              {pickingNative ? "Opening..." : "System Picker"}
            </button>
          </div>
          <DirectoryBrowser
            initialPath=""
            onSelect={handleSelectPath}
            onCancel={onCancel}
          />
        </div>
      )}

      {/* Save action */}
      {selectedPath && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!name.trim() || saving}
            className="btn-primary px-4 py-1.5 text-sm disabled:opacity-40"
          >
            {saving ? "Adding..." : "Add Folder"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** Edit-folder panel: name + path with directory browser */
function EditFolderPanel({
  repo,
  onSave,
  onCancel,
}: {
  repo: ProjectRepo;
  onSave: (name: string, path: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(repo.name);
  const [selectedPath, setSelectedPath] = useState(repo.path ?? "");
  const [showBrowser, setShowBrowser] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickingNative, setPickingNative] = useState(false);

  const handleNativePick = useCallback(async () => {
    setPickingNative(true);
    try {
      const res = await fetch("/api/filesystem/pick-folder", { method: "POST" });
      const data = await res.json();
      if (data.path) {
        setSelectedPath(data.path);
        setShowBrowser(false);
      }
    } catch { /* ignore */ }
    setPickingNative(false);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-300">Edit Folder</h3>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-500">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input w-full text-sm"
          placeholder="Folder name"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-zinc-500">Path</label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowBrowser(!showBrowser)}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {showBrowser ? "Type path" : "Browse"}
            </button>
            <button
              type="button"
              onClick={() => void handleNativePick()}
              disabled={pickingNative}
              className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
            >
              <FolderSearch className="w-3 h-3" />
              {pickingNative ? "Opening..." : "System Picker"}
            </button>
          </div>
        </div>
        {showBrowser ? (
          <DirectoryBrowser
            initialPath={selectedPath}
            onSelect={(path) => { setSelectedPath(path); setShowBrowser(false); }}
            onCancel={() => setShowBrowser(false)}
          />
        ) : (
          <input
            value={selectedPath}
            onChange={(e) => setSelectedPath(e.target.value)}
            className="input w-full text-sm font-mono"
            placeholder="/path/to/folder"
          />
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={async () => {
            if (!name.trim() || !selectedPath.trim()) return;
            setSaving(true);
            try { await onSave(name.trim(), selectedPath.trim()); }
            finally { setSaving(false); }
          }}
          disabled={!name.trim() || !selectedPath.trim() || saving}
          className="btn-primary px-4 py-1.5 text-sm disabled:opacity-40"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function FoldersView({ projectId }: FoldersViewProps) {
  const { projects, updateProject } = useProjectsWithAgents();
  const project = projects.find((p) => p.id === projectId);

  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [addingRepo, setAddingRepo] = useState(false);
  const [editingRepo, setEditingRepo] = useState<ProjectRepo | null>(null);
  const [repoStatus, setRepoStatus] = useState<string | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [systemNotes, setSystemNotes] = useState<Record<string, SystemNote | null>>({});
  const [analyses, setAnalyses] = useState<Record<string, RepoAnalysis>>({});
  const [analysisLoading, setAnalysisLoading] = useState<Record<string, boolean>>({});

  const repos = project?.repos ?? [];
  const selectedRepo = repos.find((r) => r.id === selectedRepoId) ?? null;

  // Auto-select first folder
  useEffect(() => {
    if (!selectedRepoId && repos.length > 0) {
      setSelectedRepoId(repos[0].id);
    }
    if (selectedRepoId && !repos.find((r) => r.id === selectedRepoId) && repos.length > 0) {
      setSelectedRepoId(repos[0].id);
    }
  }, [repos, selectedRepoId]);

  // Load system notes for all repos
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (repos.length === 0) { setSystemNotes({}); return; }
      try {
        const entries = await Promise.all(
          repos.map(async (repo) => {
            const res = await fetch(`/api/knowledge-notes?scope=repo&subjectId=${encodeURIComponent(repo.id)}`);
            const data = res.ok ? await res.json() : { note: null };
            return [repo.id, mapNote(data.note)] as const;
          })
        );
        if (!cancelled) setSystemNotes(Object.fromEntries(entries));
      } catch {
        if (!cancelled) setSystemNotes({});
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [repos]);

  // Analyze selected repo on selection
  useEffect(() => {
    if (!selectedRepo?.path || analyses[selectedRepo.id]) return;
    const repoId = selectedRepo.id;
    const repoPath = selectedRepo.path;
    setAnalysisLoading((prev) => ({ ...prev, [repoId]: true }));
    fetch("/api/filesystem/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: repoPath }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.analysis) {
          setAnalyses((prev) => ({ ...prev, [repoId]: data.analysis }));
        }
      })
      .catch(() => {})
      .finally(() => setAnalysisLoading((prev) => ({ ...prev, [repoId]: false })));
  }, [selectedRepo?.id, selectedRepo?.path, analyses]);

  const setFeedback = useCallback((msg: string) => {
    setRepoStatus(msg);
    setTimeout(() => setRepoStatus(null), 2500);
  }, []);

  const toInputs = useCallback((): ProjectRepoInput[] =>
    repos.map((r) => ({ id: r.id, name: r.name, path: r.path, git_url: r.git_url, notes: r.notes })),
    [repos]
  );

  const handleAdd = useCallback(async (name: string, path: string) => {
    try {
      await updateProject(projectId, { repos: [...toInputs(), { name, path }] });
      setAddingRepo(false);
      setFeedback("Folder added");
    } catch { setFeedback("Failed to add"); }
  }, [updateProject, projectId, toInputs, setFeedback]);

  const handleEditSave = useCallback(async (name: string, path: string) => {
    if (!editingRepo) return;
    const updated = toInputs().map((r) =>
      r.id === editingRepo.id ? { ...r, name, path } : r
    );
    try {
      await updateProject(projectId, { repos: updated });
      setEditingRepo(null);
      // Invalidate analysis cache for this repo since path may have changed
      setAnalyses((prev) => {
        const next = { ...prev };
        delete next[editingRepo.id];
        return next;
      });
      setFeedback("Folder updated");
    } catch { setFeedback("Failed to update"); }
  }, [editingRepo, updateProject, projectId, toInputs, setFeedback]);

  const handleDelete = useCallback(async (repoId: string) => {
    try {
      await updateProject(projectId, { repos: toInputs().filter((r) => r.id !== repoId) });
      if (selectedRepoId === repoId) setSelectedRepoId(null);
      setFeedback("Folder removed");
    } catch { setFeedback("Failed to remove"); }
  }, [updateProject, projectId, toInputs, selectedRepoId, setFeedback]);

  const handleNoteSave = useCallback(async (repoId: string, content: string) => {
    setNoteSaving(true);
    const updated = toInputs().map((r) =>
      r.id === repoId ? { ...r, notes: content } : r
    );
    try {
      await updateProject(projectId, { repos: updated });
      setFeedback("Notes saved");
    } catch {
      setFeedback("Failed to save notes");
    } finally {
      setNoteSaving(false);
    }
  }, [updateProject, projectId, toInputs, setFeedback]);

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-zinc-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left panel: folder list */}
      <div className="w-72 flex-shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-950/30">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50">
          <div className="flex items-center gap-2">
            <FolderGit2 className="w-4 h-4 text-zinc-400" />
            <span className="text-sm font-medium text-zinc-300">Folders</span>
            {repos.length > 0 && (
              <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500">
                {repos.length}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => { setAddingRepo(true); setEditingRepo(null); }}
            className="p-1 rounded-lg text-zinc-500 hover:text-blue-400 hover:bg-zinc-800 transition-colors"
            title="Add folder"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {repos.length === 0 && !addingRepo && (
            <div className="px-3 py-8 text-center">
              <FolderGit2 className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
              <p className="text-sm text-zinc-500 mb-1">No folders yet</p>
              <p className="text-xs text-zinc-600 mb-4">Link local repos or project directories</p>
              <button
                type="button"
                onClick={() => setAddingRepo(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-blue-400 border border-blue-500/20 hover:bg-blue-500/10 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add Folder
              </button>
            </div>
          )}

          {repos.map((repo) => (
            <FolderRow
              key={repo.id}
              repo={repo}
              isSelected={selectedRepoId === repo.id}
              onSelect={() => { setSelectedRepoId(repo.id); setAddingRepo(false); setEditingRepo(null); }}
            />
          ))}
        </div>

        {repoStatus && (
          <div className="px-4 py-2 border-t border-zinc-800/50">
            <span className="text-xs text-zinc-500">{repoStatus}</span>
          </div>
        )}
      </div>

      {/* Right panel: detail / form */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-6">
          {addingRepo ? (
            <AddFolderPanel onAdd={handleAdd} onCancel={() => setAddingRepo(false)} />
          ) : editingRepo ? (
            <EditFolderPanel
              repo={editingRepo}
              onSave={handleEditSave}
              onCancel={() => setEditingRepo(null)}
            />
          ) : selectedRepo ? (
            <FolderDetail
              repo={selectedRepo}
              systemNote={systemNotes[selectedRepo.id] ?? null}
              analysis={analyses[selectedRepo.id] ?? null}
              analysisLoading={analysisLoading[selectedRepo.id] ?? false}
              onNoteSave={handleNoteSave}
              noteSaving={noteSaving}
              onEdit={(r) => setEditingRepo(r)}
              onDelete={handleDelete}
            />
          ) : repos.length > 0 ? (
            <div className="flex items-center justify-center h-64 text-sm text-zinc-600">
              Select a folder to view details
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
