"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface DirEntry {
  name: string;
  path: string;
}

interface BrowseResult {
  current: string;
  parent: string | null;
  dirs: DirEntry[];
}

export default function DirectoryBrowser({
  initialPath,
  onSelect,
  onCancel,
}: {
  initialPath: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}) {
  const [browsePath, setBrowsePath] = useState(initialPath || "");
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const fetchDir = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = dirPath ? `?path=${encodeURIComponent(dirPath)}` : "";
      const res = await fetch(`/api/filesystem/browse${params}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to browse");
        return;
      }
      setResult(data);
      setBrowsePath(data.current);
      listRef.current?.scrollTo(0, 0);
    } catch {
      setError("Failed to connect");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDir(initialPath || "");
  }, []);

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden shadow-lg">
      {/* Path bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--card-border)] bg-[var(--muted)]/30">
        <input
          value={browsePath}
          onChange={(e) => setBrowsePath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") fetchDir(browsePath);
          }}
          className="input text-xs flex-1 py-1"
          placeholder="Enter path..."
        />
        <button
          type="button"
          onClick={() => fetchDir(browsePath)}
          className="text-[10px] font-bold uppercase tracking-wider text-[var(--primary)] hover:underline px-2 py-1 shrink-0"
        >
          Go
        </button>
      </div>

      {/* Directory listing */}
      <div ref={listRef} className="max-h-48 overflow-y-auto">
        {loading && (
          <div className="px-3 py-4 text-xs text-[var(--muted-foreground)] text-center">Loading...</div>
        )}
        {error && (
          <div className="px-3 py-4 text-xs text-[var(--destructive)] text-center">{error}</div>
        )}
        {!loading && result && (
          <div className="py-1">
            {result.parent && (
              <button
                type="button"
                onClick={() => fetchDir(result.parent!)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--muted)]/50 transition-colors flex items-center gap-2"
              >
                <span className="text-[var(--muted-foreground)]">↑</span>
                <span className="text-[var(--muted-foreground)]">..</span>
              </button>
            )}
            {result.dirs.length === 0 && !result.parent && (
              <div className="px-3 py-3 text-xs text-[var(--muted-foreground)] text-center">No subdirectories</div>
            )}
            {result.dirs.map((dir) => (
              <button
                key={dir.path}
                type="button"
                onClick={() => fetchDir(dir.path)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--muted)]/50 transition-colors flex items-center gap-2"
              >
                <span className="text-[var(--muted-foreground)]">📁</span>
                <span className="truncate">{dir.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--card-border)] bg-[var(--muted)]/30">
        <span className="text-[10px] text-[var(--muted-foreground)] truncate max-w-[60%]">
          {result?.current || browsePath}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-medium text-[var(--muted-foreground)] hover:underline px-2 py-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSelect(result?.current || browsePath)}
            className="text-xs font-bold text-[var(--primary)] hover:underline px-2 py-1"
          >
            Select
          </button>
        </div>
      </div>
    </div>
  );
}
