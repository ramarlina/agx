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
      className="rounded p-1 text-[var(--app-shell-soft-text)] transition-colors hover:text-[var(--foreground)]"
      title="Copy path"
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function LanguageBadge({ lang, count }: { lang: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--secondary)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
      {lang}
      <span className="text-[var(--app-shell-soft-text)]">{count}</span>
    </span>
  );
}

function AnalysisSummary({ analysis }: { analysis: RepoAnalysis }) {
  const topLangs = Object.entries(analysis.languages)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card-bg)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <HardDrive className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Analysis</span>
      </div>
      <div className="px-4 py-3 space-y-3">
        {/* Git info */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            {analysis.isGit ? (
              <span className="text-xs text-[var(--foreground)]">
                {analysis.branch ?? "detached"}
              </span>
            ) : (
              <span className="text-xs italic text-[var(--muted-foreground)]">Not a git repo</span>
            )}
          </div>
          {analysis.isGit && analysis.status && (
            <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              {analysis.status.staged > 0 && (
                <span className="text-[var(--status-completed-text)]">{analysis.status.staged} staged</span>
              )}
              {analysis.status.modified > 0 && (
                <span className="text-[var(--status-blocked-text)]">{analysis.status.modified} modified</span>
              )}
              {analysis.status.untracked > 0 && (
                <span className="text-[var(--muted-foreground)]">{analysis.status.untracked} untracked</span>
              )}
              {analysis.status.staged === 0 && analysis.status.modified === 0 && analysis.status.untracked === 0 && (
                <span className="text-[var(--app-shell-soft-text)]">clean</span>
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
          ? "border border-blue-500/20 bg-blue-500/10"
          : "border border-transparent hover:bg-[var(--secondary)]"
      }`}
    >
      {isSelected ? (
        <FolderOpen className="w-4 h-4 text-blue-400 flex-shrink-0" />
      ) : (
        <FolderGit2 className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
      )}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-medium ${isSelected ? "text-blue-500" : "text-[var(--foreground)]"}`}>
          {repo.name}
        </div>
        <div className="truncate text-xs text-[var(--muted-foreground)]">
          {repo.path || repo.git_url || "No path set"}
        </div>
      </div>
      <ChevronRight
        className={`w-3.5 h-3.5 flex-shrink-0 transition-colors ${
          isSelected ? "text-blue-500" : "text-[var(--app-shell-soft-text)] group-hover:text-[var(--muted-foreground)]"
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
            <h3 className="truncate text-lg font-semibold text-[var(--foreground)]">{repo.name}</h3>
          </div>
          {repo.path && (
            <div className="flex items-center gap-1.5 ml-7">
              <code className="truncate font-mono text-xs text-[var(--muted-foreground)]">{repo.path}</code>
              <CopyPathButton path={repo.path} />
            </div>
          )}
          {repo.git_url && (
            <div className="flex items-center gap-1.5 ml-7 mt-1">
              <ExternalLink className="h-3 w-3 flex-shrink-0 text-[var(--app-shell-soft-text)]" />
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
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            title="Edit folder"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(repo.id)}
            className="rounded-lg p-1.5 text-[var(--app-shell-soft-text)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--destructive)]"
            title="Delete folder"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Analysis */}
      {analysisLoading && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] px-4 py-3">
          <span className="animate-pulse text-xs text-[var(--muted-foreground)]">Analyzing folder...</span>
        </div>
      )}
      {!analysisLoading && analysis && <AnalysisSummary analysis={analysis} />}

      {/* Notes section */}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card-bg)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Notes</span>
          </div>
          {!editingNotes ? (
            <button
              type="button"
              onClick={() => {
                setLocalNotes(notes);
                setEditingNotes(true);
              }}
              className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[var(--app-shell-soft-text)]">Cmd+Enter to save</span>
              <button
                type="button"
                onClick={() => {
                  setEditingNotes(false);
                  setLocalNotes(notes);
                }}
                className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
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
                className="flex items-center gap-1 text-xs text-blue-500 transition-colors hover:text-blue-600 disabled:opacity-50"
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
              className="min-h-[120px] w-full resize-none bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--app-shell-soft-text)]"
              placeholder="Add notes about this folder... (architecture, conventions, important files, etc.)"
              autoFocus
            />
          ) : notes ? (
            <p className="whitespace-pre-wrap text-sm text-[var(--foreground)]">{notes}</p>
          ) : (
            <p className="text-sm italic text-[var(--muted-foreground)]">No notes yet. Click edit to describe this folder.</p>
          )}
        </div>
      </div>

      {/* System-generated knowledge */}
      {systemNote && (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--secondary)]">
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
              Generated Knowledge
            </span>
            {systemNote.updated_at && (
              <span className="ml-auto text-xs text-[var(--app-shell-soft-text)]">
                {new Date(systemNote.updated_at).toLocaleDateString()}
              </span>
            )}
          </div>
          <div className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed text-[var(--muted-foreground)]">
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
        <h3 className="text-sm font-medium text-[var(--foreground)]">Add Folder</h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Name input */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--muted-foreground)]">Name</label>
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
        <div className="px-1 text-xs text-[var(--muted-foreground)] animate-pulse">Analyzing...</div>
      )}
      {!analyzing && analysis && <AnalysisSummary analysis={analysis} />}

      {/* Directory browser or native picker */}
      {!selectedPath && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Choose a folder</span>
            <button
              type="button"
              onClick={() => void handleNativePick()}
              disabled={pickingNative}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--card-hover-border)] hover:text-[var(--foreground)] disabled:opacity-50"
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
            className="px-4 py-1.5 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
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
        <h3 className="text-sm font-medium text-[var(--foreground)]">Edit Folder</h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--muted-foreground)]">Name</label>
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
          <label className="text-xs font-medium text-[var(--muted-foreground)]">Path</label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowBrowser(!showBrowser)}
              className="text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              {showBrowser ? "Type path" : "Browse"}
            </button>
            <button
              type="button"
              onClick={() => void handleNativePick()}
              disabled={pickingNative}
              className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
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
          className="px-4 py-1.5 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
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
      <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left panel: folder list */}
      <div className="flex w-72 flex-shrink-0 flex-col border-r border-[var(--border)] bg-[var(--app-shell-pane)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <FolderGit2 className="h-4 w-4 text-[var(--muted-foreground)]" />
            <span className="text-sm font-medium text-[var(--foreground)]">Folders</span>
            {repos.length > 0 && (
              <span className="rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-xs text-[var(--muted-foreground)]">
                {repos.length}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => { setAddingRepo(true); setEditingRepo(null); }}
            className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-blue-500"
            title="Add folder"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {repos.length === 0 && !addingRepo && (
            <div className="px-3 py-8 text-center">
              <FolderGit2 className="mx-auto mb-3 h-8 w-8 text-[var(--app-shell-soft-text)]" />
              <p className="mb-1 text-sm text-[var(--muted-foreground)]">No folders yet</p>
              <p className="mb-4 text-xs text-[var(--app-shell-soft-text)]">Link local repos or project directories</p>
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
          <div className="border-t border-[var(--border)] px-4 py-2">
            <span className="text-xs text-[var(--muted-foreground)]">{repoStatus}</span>
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
            <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)]">
              Select a folder to view details
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
