"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { FileSuggestion } from "@/types/fileMention";
import { FileSuggestionList } from "@/components/FileSuggestionList";

export interface FileSearchInputProps {
  /** Placeholder text for the input */
  placeholder?: string;
  /** Workspace root to pass to /api/file-search */
  root?: string;
  /** Called when the user confirms a suggestion (Enter or click) */
  onSelect?: (suggestion: FileSuggestion) => void;
  /** Extra class names applied to the container */
  className?: string;
  /** Input value (controlled) */
  value?: string;
  /** Change handler for controlled usage */
  onChange?: (value: string) => void;
}

type FetchState = "idle" | "loading" | "error";

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function FileSearchInput({
  placeholder = "Search files…",
  root,
  onSelect,
  className,
  value: controlledValue,
  onChange: controlledOnChange,
}: FileSearchInputProps) {
  const isControlled = controlledValue !== undefined;

  const [internalQuery, setInternalQuery] = useState("");
  const query = isControlled ? controlledValue : internalQuery;

  const [suggestions, setSuggestions] = useState<FileSuggestion[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [fetchState, setFetchState] = useState<FetchState>("idle");
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const listboxId = useId();
  const debouncedQuery = useDebounce(query, 200);

  // Fetch suggestions whenever debounced query changes
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSuggestions([]);
      setHasMore(false);
      setFetchState("idle");
      setIsOpen(false);
      return;
    }

    // Cancel any in-flight request
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setFetchState("loading");
    setCursor(undefined);

    const params = new URLSearchParams({ q: debouncedQuery.trim() });
    if (root) params.set("root", root);

    fetch(`/api/file-search?${params}`, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { files: FileSuggestion[]; hasMore: boolean; cursor?: string }) => {
        setSuggestions(data.files ?? []);
        setHasMore(data.hasMore ?? false);
        setCursor(data.cursor);
        setActiveIndex(-1);
        setIsOpen(true);
        setFetchState("idle");
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setFetchState("error");
        setSuggestions([]);
        setIsOpen(true);
      });

    return () => ctrl.abort();
  }, [debouncedQuery, root]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      if (isControlled) {
        controlledOnChange?.(v);
      } else {
        setInternalQuery(v);
      }
    },
    [isControlled, controlledOnChange]
  );

  const confirmSelection = useCallback(
    (suggestion: FileSuggestion) => {
      onSelect?.(suggestion);
      setIsOpen(false);
      setSuggestions([]);
      if (!isControlled) setInternalQuery("");
      inputRef.current?.focus();
    },
    [onSelect, isControlled]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
          break;
        case "Enter":
          e.preventDefault();
          if (activeIndex >= 0 && activeIndex < suggestions.length) {
            confirmSelection(suggestions[activeIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          setActiveIndex(-1);
          break;
      }
    },
    [isOpen, suggestions, activeIndex, confirmSelection]
  );

  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Delay close so click on a list item fires first
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setTimeout(() => setIsOpen(false), 150);
    }
  }, []);

  const handleLoadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    loadMoreAbortRef.current?.abort();
    const ctrl = new AbortController();
    loadMoreAbortRef.current = ctrl;
    setLoadingMore(true);

    const params = new URLSearchParams({ q: debouncedQuery.trim() });
    if (root) params.set("root", root);
    params.set("cursor", cursor);

    fetch(`/api/file-search?${params}`, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { files: FileSuggestion[]; hasMore: boolean; cursor?: string }) => {
        setSuggestions((prev) => [...prev, ...(data.files ?? [])]);
        setHasMore(data.hasMore ?? false);
        setCursor(data.cursor);
        setLoadingMore(false);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setLoadingMore(false);
      });
  }, [cursor, loadingMore, debouncedQuery, root]);

  const activeDescendant =
    activeIndex >= 0 ? `fsl-option-${activeIndex}` : undefined;

  const statusMessage =
    fetchState === "loading"
      ? "Searching…"
      : fetchState === "error"
      ? "Search failed"
      : isOpen && suggestions.length === 0
      ? "No results"
      : isOpen
      ? `${suggestions.length} result${suggestions.length === 1 ? "" : "s"}${hasMore ? "+" : ""}`
      : "";

  return (
    <div
      className={`relative ${className ?? ""}`}
      onBlur={handleBlur}
    >
      {/* Combobox input */}
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={activeDescendant}
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {/* Loading spinner overlay */}
      {fetchState === "loading" && (
        <span
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        >
          <svg
            className="h-4 w-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </span>
      )}

      {/* Dropdown */}
      <div
        className={`absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md overflow-hidden transition-all duration-150 ${
          isOpen ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 -translate-y-1 pointer-events-none"
        }`}
        id={listboxId}
        aria-hidden={!isOpen}
      >
        {fetchState === "error" ? (
          <p
            role="status"
            className="px-3 py-2 text-sm text-destructive"
          >
            Search failed. Please try again.
          </p>
        ) : suggestions.length === 0 && fetchState !== "loading" ? (
          <p
            role="status"
            className="px-3 py-2 text-sm text-muted-foreground"
          >
            No results
          </p>
        ) : (
          <>
            <div className="max-h-64 overflow-y-auto">
              <FileSuggestionList
                ref={listRef}
                suggestions={suggestions}
                activeIndex={activeIndex >= 0 ? activeIndex : undefined}
                onSelect={confirmSelection}
              />
            </div>
            {hasMore && (
              <div className="border-t px-2 py-1.5">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="w-full min-h-[44px] rounded px-3 py-2 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Screen reader live region */}
      <span className="sr-only" role="status" aria-live="polite">
        {statusMessage}
      </span>
    </div>
  );
}
