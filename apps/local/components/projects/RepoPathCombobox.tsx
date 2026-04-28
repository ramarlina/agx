"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Folder, Loader2 } from "lucide-react";
import type { SuggestedRepo } from "@/lib/repo-suggestions";

interface SuggestedReposResponse {
  repos: SuggestedRepo[];
  scanning: boolean;
  scannedAt: number | null;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSelectMatch?: (repo: { path: string; basename: string }) => void;
  placeholder?: string;
  disabled?: boolean;
  category: string;
  className?: string;
}

interface ModuleCache {
  repos: SuggestedRepo[];
  scanning: boolean;
  scannedAt: number | null;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;
const cacheState: { current: ModuleCache | null; inflight: Promise<ModuleCache> | null } = {
  current: null,
  inflight: null,
};

async function fetchRepoIndex(force: boolean): Promise<ModuleCache> {
  const now = Date.now();
  if (
    !force &&
    cacheState.current &&
    now - cacheState.current.fetchedAt < CACHE_TTL_MS
  ) {
    return cacheState.current;
  }
  if (cacheState.inflight) {
    return cacheState.inflight;
  }
  cacheState.inflight = (async () => {
    const response = await fetch(`/api/git/repos?limit=200`);
    if (!response.ok) {
      throw new Error("Failed to fetch repository index");
    }
    const data = (await response.json()) as SuggestedReposResponse;
    const next: ModuleCache = {
      repos: data.repos ?? [],
      scanning: Boolean(data.scanning),
      scannedAt: data.scannedAt ?? null,
      fetchedAt: Date.now(),
    };
    cacheState.current = next;
    return next;
  })();
  try {
    return await cacheState.inflight;
  } finally {
    cacheState.inflight = null;
  }
}

function scoreEntry(repo: SuggestedRepo, query: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const basename = repo.basename.toLowerCase();
  const path = repo.path.toLowerCase();
  if (basename === q) return 100;
  if (basename.startsWith(q)) return 50;
  if (basename.includes(q)) return 25;
  if (path.includes(q)) return 10;
  return 0;
}

function filterRepos(repos: SuggestedRepo[], query: string, max: number): SuggestedRepo[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...repos]
      .sort((a, b) => {
        if (a.path.length !== b.path.length) return a.path.length - b.path.length;
        return a.path.localeCompare(b.path);
      })
      .slice(0, max);
  }
  const scored: Array<{ repo: SuggestedRepo; score: number }> = [];
  for (const repo of repos) {
    const basename = repo.basename.toLowerCase();
    const path = repo.path.toLowerCase();
    if (!basename.includes(q) && !path.includes(q)) continue;
    scored.push({ repo, score: scoreEntry(repo, q) });
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.repo.path.length !== b.repo.path.length)
      return a.repo.path.length - b.repo.path.length;
    return a.repo.path.localeCompare(b.repo.path);
  });
  return scored.slice(0, max).map((s) => s.repo);
}

export function RepoPathCombobox({
  value,
  onChange,
  onSelectMatch,
  placeholder,
  disabled,
  category,
  className,
}: Props) {
  const isRepoMode = category === "repositories";
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [cache, setCache] = useState<ModuleCache | null>(cacheState.current);
  const [loading, setLoading] = useState(false);

  const inputClassName =
    className ??
    "w-full rounded-xl border border-[var(--border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--foreground)]";

  const ensureFetched = useCallback(async () => {
    if (!isRepoMode) return;
    setLoading(true);
    try {
      const data = await fetchRepoIndex(false);
      setCache(data);
    } catch {
      // swallow
    } finally {
      setLoading(false);
    }
  }, [isRepoMode]);

  const matches = useMemo(() => {
    if (!isRepoMode || !cache) return [] as SuggestedRepo[];
    return filterRepos(cache.repos, value, 8);
  }, [cache, isRepoMode, value]);

  useEffect(() => {
    setActiveIndex(0);
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const commitSelection = useCallback(
    (repo: SuggestedRepo) => {
      onChange(repo.path);
      onSelectMatch?.({ path: repo.path, basename: repo.basename });
      setOpen(false);
      inputRef.current?.blur();
    },
    [onChange, onSelectMatch],
  );

  const handleFocus = useCallback(() => {
    if (!isRepoMode) return;
    setOpen(true);
    void ensureFetched();
  }, [ensureFetched, isRepoMode]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isRepoMode) return;
      if (event.key === "Escape") {
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        return;
      }
      if (!open) {
        if (
          event.key === "ArrowDown" ||
          event.key === "ArrowUp" ||
          event.key === "Enter"
        ) {
          if (matches.length > 0 || cache?.scanning) {
            setOpen(true);
          }
        }
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => (matches.length === 0 ? 0 : (i + 1) % matches.length));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) =>
          matches.length === 0 ? 0 : (i - 1 + matches.length) % matches.length,
        );
      } else if (event.key === "Enter") {
        if (matches[activeIndex]) {
          event.preventDefault();
          commitSelection(matches[activeIndex]);
        }
      }
    },
    [activeIndex, cache?.scanning, commitSelection, isRepoMode, matches, open],
  );

  if (!isRepoMode) {
    return (
      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName}
      />
    );
  }

  const showIndexingHint =
    Boolean(cache?.scanning) && (cache?.repos.length ?? 0) === 0;

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={handleFocus}
        onChange={(event) => {
          onChange(event.target.value);
          if (!open) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        spellCheck={false}
        className={inputClassName}
      />
      {open && (matches.length > 0 || showIndexingHint || loading) && (
        <div
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--card-bg)] shadow-lg"
          role="listbox"
        >
          {matches.map((repo, i) => {
            const active = i === activeIndex;
            return (
              <button
                key={repo.path}
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  commitSelection(repo);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? "bg-[var(--secondary)] text-[var(--foreground)]"
                    : "text-[var(--foreground)] hover:bg-[var(--secondary)]/60"
                }`}
              >
                <Folder className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="truncate font-medium">{repo.basename}</span>
                  <span className="truncate font-mono text-[11px] text-[var(--muted-foreground)]">
                    {repo.path}
                  </span>
                </span>
              </button>
            );
          })}
          {matches.length === 0 && loading && (
            <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
              Loading...
            </p>
          )}
          {showIndexingHint && (
            <p className="flex items-center gap-1.5 border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Indexing...
            </p>
          )}
        </div>
      )}
    </div>
  );
}
