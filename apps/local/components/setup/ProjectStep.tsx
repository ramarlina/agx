// components/setup/ProjectStep.tsx
"use client";

import { useState, useCallback } from "react";
import { Folder, GitBranch, FileCode, X, Loader2 } from "lucide-react";
import { useRepoAnalysis } from "@/hooks/useRepoAnalysis";
import { SetupLayout } from "./SetupLayout";

export interface ProjectData {
  name: string;
  description: string;
  folders: Array<{ name: string; path: string }>;
}

interface ProjectStepProps {
  data: ProjectData;
  onChange: (data: ProjectData) => void;
  onNext: () => void;
  onBack: () => void;
}

function RepoAnalysisPanel({ folderPath }: { folderPath: string }) {
  const { analysis, loading } = useRepoAnalysis(folderPath);

  if (loading) {
    return (
      <div className="flex items-center gap-2 mt-2 text-[12px] text-[var(--muted-foreground)]">
        <Loader2 className="w-3 h-3 animate-spin" /> Analyzing...
      </div>
    );
  }
  if (!analysis) return null;

  const topLangs = Object.entries(analysis.languages)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-[var(--muted-foreground)]">
      {analysis.isGit && analysis.branch && (
        <span className="inline-flex items-center gap-1">
          <GitBranch className="w-3 h-3" /> {analysis.branch}
        </span>
      )}
      {analysis.isGit && analysis.status && (
        <span>
          {analysis.status.modified}M {analysis.status.untracked}? {analysis.status.staged}S
        </span>
      )}
      {topLangs.map(([lang, count]) => (
        <span key={lang} className="inline-flex items-center gap-1">
          <FileCode className="w-3 h-3" /> {lang} ({count})
        </span>
      ))}
    </div>
  );
}

export function ProjectStep({ data, onChange, onNext, onBack }: ProjectStepProps) {
  const [pickingFolder, setPickingFolder] = useState(false);

  const handlePickFolder = useCallback(async () => {
    setPickingFolder(true);
    try {
      const res = await fetch("/api/filesystem/pick-folder", { method: "POST" });
      if (!res.ok) return;
      const result = await res.json();
      if (result.cancelled || !result.path) return;

      const folderName = result.path.split("/").filter(Boolean).pop() || result.path;
      if (data.folders.some((f) => f.path === result.path)) return;

      onChange({
        ...data,
        name: data.name || folderName,
        folders: [...data.folders, { name: folderName, path: result.path }],
      });
    } catch { /* ignore */ }
    finally { setPickingFolder(false); }
  }, [data, onChange]);

  const handleRemoveFolder = useCallback((path: string) => {
    onChange({ ...data, folders: data.folders.filter((f) => f.path !== path) });
  }, [data, onChange]);

  const canProceed = data.name.trim().length > 0;

  return (
    <SetupLayout
      currentStep={2}
      totalSteps={3}
      footer={
        <div className="flex items-center justify-between">
          <button type="button" onClick={onBack} className="text-[14px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            Back
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!canProceed}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-[var(--foreground)] text-[var(--background)] text-[14px] font-semibold rounded-lg hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      }
    >
      <div className="text-center mb-8">
        <h1 className="text-[24px] font-bold text-[var(--foreground)] tracking-tight">Create Your Project</h1>
        <p className="mt-2 text-[14px] text-[var(--muted-foreground)]">Name your project and attach folders your agents will work in.</p>
      </div>

      <div className="space-y-6">
        {/* Name */}
        <div>
          <label htmlFor="project-name" className="block text-[13px] font-medium text-[var(--foreground)] mb-1.5">
            Project name
          </label>
          <input
            id="project-name"
            type="text"
            value={data.name}
            onChange={(e) => onChange({ ...data, name: e.target.value })}
            placeholder="My Project"
            className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[14px] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--foreground)]/20"
            autoFocus
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="project-desc" className="block text-[13px] font-medium text-[var(--foreground)] mb-1.5">
            Description <span className="text-[var(--muted-foreground)] font-normal">(optional)</span>
          </label>
          <input
            id="project-desc"
            type="text"
            value={data.description}
            onChange={(e) => onChange({ ...data, description: e.target.value })}
            placeholder="What this project is about"
            className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[14px] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--foreground)]/20"
          />
        </div>

        {/* Folders */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[13px] font-medium text-[var(--foreground)]">Folders</label>
            <button
              type="button"
              onClick={handlePickFolder}
              disabled={pickingFolder}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md border border-[var(--border)] hover:bg-[var(--secondary)] transition-colors disabled:opacity-60"
            >
              {pickingFolder ? <Loader2 className="w-3 h-3 animate-spin" /> : <Folder className="w-3 h-3" />}
              Browse
            </button>
          </div>

          {data.folders.length === 0 ? (
            <p className="text-[13px] text-[var(--muted-foreground)] py-4 text-center border border-dashed border-[var(--border)] rounded-lg">
              No folders attached yet. Click Browse to add one.
            </p>
          ) : (
            <div className="space-y-2">
              {data.folders.map((folder) => (
                <div key={folder.path} className="border border-[var(--card-border)] rounded-lg px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <Folder className="w-4 h-4 text-[var(--muted-foreground)] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-[var(--foreground)] truncate">{folder.name}</p>
                        <p className="text-[11px] text-[var(--muted-foreground)] truncate">{folder.path}</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => handleRemoveFolder(folder.path)} className="p-1 rounded hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <RepoAnalysisPanel folderPath={folder.path} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </SetupLayout>
  );
}
