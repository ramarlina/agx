"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bot,
  Clock3,
  FileText,
  Loader2,
  MessageSquare,
  Search,
  Target,
  Users,
  X,
} from "lucide-react";
import type {
  ProjectSearchResponse,
  ProjectSearchResult,
  ProjectSearchResultKind,
  ProjectSearchSection,
} from "@/lib/project-search";
import { useInputCapabilities } from "@/hooks/useInputCapabilities";

interface ProjectSearchBarProps {
  projectId: string;
}

const COLLAPSED_RESULTS_PER_SECTION = 3;

function renderSnippet(snippet: string) {
  const parts = snippet.split(/(<\/?mark>)/g);
  let highlighted = false;

  return parts.map((part, index) => {
    if (part === "<mark>") {
      highlighted = true;
      return null;
    }
    if (part === "</mark>") {
      highlighted = false;
      return null;
    }
    if (!part) {
      return null;
    }

    return highlighted ? (
      <mark
        key={`mark-${index}`}
        className="rounded bg-amber-200/80 px-0.5 text-inherit"
      >
        {part}
      </mark>
    ) : (
      <span key={`text-${index}`}>{part}</span>
    );
  });
}

function iconForKind(kind: ProjectSearchResultKind) {
  switch (kind) {
    case "objective":
      return Target;
    case "linear_issue":
      return FileText;
    case "scheduled_task":
      return Clock3;
    case "team":
      return Users;
    case "agent":
      return Bot;
    case "chat_thread":
    case "chat_message":
      return MessageSquare;
    default:
      return Search;
  }
}

export function ProjectSearchBar({ projectId }: ProjectSearchBarProps) {
  const { isTouchLayout } = useInputCapabilities();
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [sections, setSections] = useState<ProjectSearchSection[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const normalizedQuery = query.trim();
  const visibleSections = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        visibleResults: expandedSections.has(section.id)
          ? section.results
          : section.results.slice(0, COLLAPSED_RESULTS_PER_SECTION),
        hiddenCount: Math.max(0, section.results.length - COLLAPSED_RESULTS_PER_SECTION),
      })),
    [expandedSections, sections],
  );
  const flattenedResults = useMemo(
    () => visibleSections.flatMap((section) => section.visibleResults),
    [visibleSections],
  );
  const flattenedKeys = useMemo(
    () => flattenedResults.map((result) => `${result.kind}:${result.id}`),
    [flattenedResults],
  );

  const clearSearch = useCallback(() => {
    setQuery("");
    setSections([]);
    setTotal(0);
    setError(null);
    setLoading(false);
    setActiveIndex(0);
  }, []);

  const handleSelect = useCallback(
    (result: ProjectSearchResult) => {
      clearSearch();
      setIsOpen(false);
      router.push(result.href);
    },
    [clearSearch, router],
  );

  useEffect(() => {
    clearSearch();
    setIsOpen(false);
    setExpandedSections(new Set());
  }, [clearSearch, pathname]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setActiveIndex(0);
  }, [isOpen, sections]);

  useEffect(() => {
    if (!normalizedQuery) {
      setSections([]);
      setTotal(0);
      setError(null);
      setLoading(false);
      setExpandedSections(new Set());
      return;
    }

    if (normalizedQuery.length < 2) {
      setSections([]);
      setTotal(0);
      setError(null);
      setLoading(false);
      setExpandedSections(new Set());
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({ q: normalizedQuery });
          const response = await fetch(
            `/api/projects/${encodeURIComponent(projectId)}/search?${params.toString()}`,
            { cache: "no-store" },
          );
          const payload = (await response.json().catch(() => null)) as
            | ProjectSearchResponse
            | { error?: string }
            | null;

          if (cancelled) {
            return;
          }

          if (!response.ok) {
            const message =
              payload && typeof payload === "object" && "error" in payload
                ? String(payload.error)
                : "Search failed";
            setSections([]);
            setTotal(0);
            setError(message);
            return;
          }

          const data = payload as ProjectSearchResponse;
          setSections(Array.isArray(data.sections) ? data.sections : []);
          setTotal(typeof data.total === "number" ? data.total : 0);
          setError(null);
          setExpandedSections(new Set());
        } catch (fetchError) {
          if (cancelled) {
            return;
          }
          console.error("Project search failed", fetchError);
          setSections([]);
          setTotal(0);
          setError("Search failed");
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [normalizedQuery, projectId]);

  const showPanel = isOpen && (normalizedQuery.length > 0 || loading || error !== null);
  const activeResult =
    flattenedResults.length > 0 ? flattenedResults[Math.max(0, Math.min(activeIndex, flattenedResults.length - 1))] : null;
  const toggleSectionExpansion = useCallback((sectionId: string) => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }, []);

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <div className="group/search relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--app-shell-soft-text)] transition-colors group-focus-within/search:text-[var(--primary)]"
          strokeWidth={1.8}
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && flattenedResults.length > 0) {
              event.preventDefault();
              setActiveIndex((current) => (current + 1) % flattenedResults.length);
              return;
            }
            if (event.key === "ArrowUp" && flattenedResults.length > 0) {
              event.preventDefault();
              setActiveIndex((current) => (current - 1 + flattenedResults.length) % flattenedResults.length);
              return;
            }
            if (event.key === "Enter" && activeResult) {
              event.preventDefault();
              handleSelect(activeResult);
              return;
            }
            if (event.key === "Escape") {
              if (normalizedQuery) {
                clearSearch();
              } else {
                setIsOpen(false);
                inputRef.current?.blur();
              }
            }
          }}
          placeholder="Search objectives, tickets, tasks, teams, agents, and chat…"
          className="h-8 w-full rounded-xl border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] pl-9 pr-16 text-xs font-medium text-[var(--foreground)] outline-none placeholder:text-[var(--app-shell-soft-text)] transition-all hover:border-[var(--app-shell-border-strong)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--ring)]"
        />
        {normalizedQuery ? (
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-2">
            <span className="text-[11px] font-bold text-[var(--muted-foreground)]">
              {loading ? "…" : total}
            </span>
            <button
              type="button"
              onClick={() => {
                clearSearch();
                inputRef.current?.focus();
              }}
              className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[var(--app-shell-soft-text)] transition-colors hover:bg-[var(--app-shell-subtle)] hover:text-[var(--foreground)]"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : !isTouchLayout ? (
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-[var(--app-shell-border)] bg-[var(--app-shell-subtle)] px-1.5 py-0.5 font-sans text-[10px] font-bold text-[var(--app-shell-soft-text)]">
            ⌘K
          </kbd>
        ) : null}
      </div>

      {showPanel ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-2xl border border-[var(--app-shell-border)] bg-[var(--app-shell-surface)] shadow-2xl shadow-black/20">
          <div className="max-h-[28rem] overflow-y-auto p-2">
            {normalizedQuery.length < 2 ? (
              <div className="rounded-xl px-3 py-4 text-sm text-[var(--muted-foreground)]">
                Keep typing to search across project entities.
              </div>
            ) : null}

            {loading ? (
              <div className="flex items-center gap-2 rounded-xl px-3 py-4 text-sm text-[var(--muted-foreground)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching this project…
              </div>
            ) : null}

            {!loading && error ? (
              <div className="rounded-xl px-3 py-4 text-sm text-rose-500">{error}</div>
            ) : null}

            {!loading && !error && normalizedQuery.length >= 2 && sections.length === 0 ? (
              <div className="rounded-xl px-3 py-4 text-sm text-[var(--muted-foreground)]">
                No matches in this project.
              </div>
            ) : null}

            {!loading &&
              !error &&
              visibleSections.map((section) => (
                <div key={section.id} className="mb-2 last:mb-0">
                  <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-shell-soft-text)]">
                      {section.label}
                      <span className="ml-1.5 text-[9px] text-[var(--muted-foreground)]">
                        {section.results.length}
                      </span>
                    </div>
                    {section.results.length > COLLAPSED_RESULTS_PER_SECTION ? (
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => toggleSectionExpansion(section.id)}
                        className="text-[10px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                      >
                        {expandedSections.has(section.id)
                          ? "Collapse"
                          : `Show ${section.hiddenCount} more`}
                      </button>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    {section.visibleResults.map((result) => {
                      const resultKey = `${result.kind}:${result.id}`;
                      const globalIndex = flattenedKeys.findIndex((entry) => entry === resultKey);
                      const isActive = globalIndex === activeIndex;
                      const Icon = iconForKind(result.kind);

                      return (
                        <button
                          key={resultKey}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setActiveIndex(globalIndex)}
                          onClick={() => handleSelect(result)}
                          className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                            isActive
                              ? "bg-[var(--app-shell-subtle)] text-[var(--foreground)]"
                              : "text-[var(--foreground)] hover:bg-[var(--app-shell-subtle)]"
                          }`}
                        >
                          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] text-[var(--app-shell-muted)]">
                            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-medium">{result.title}</span>
                              <span className="shrink-0 rounded-full bg-[var(--app-shell-subtle)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-shell-soft-text)]">
                                {result.label}
                              </span>
                            </span>
                            {result.context ? (
                              <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">
                                {result.context}
                              </span>
                            ) : null}
                            {result.description ? (
                              <span className="mt-1 block text-xs leading-5 text-[var(--muted-foreground)]">
                                {renderSnippet(result.description)}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
