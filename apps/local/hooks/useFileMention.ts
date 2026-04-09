"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { FileSuggestion } from "@/types/fileMention";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Debounce delay (ms) before firing a search request */
const SEARCH_DEBOUNCE_MS = 150;

/** Minimum query length before issuing a search; below this, show root suggestions */
const MIN_QUERY_FOR_SEARCH = 3;

/**
 * Default root suggestion paths shown when the query is shorter than
 * MIN_QUERY_FOR_SEARCH. Listed in descending priority order.
 */
export const DEFAULT_ROOT_SUGGESTIONS: FileSuggestion[] = [
  { path: `${process.env.HOME ?? "~"}/Code`, relativePath: "~/Code", type: "folder" },
  { path: `${process.env.HOME ?? "~"}/Projects`, relativePath: "~/Projects", type: "folder" },
  { path: `${process.env.HOME ?? "~"}/Desktop`, relativePath: "~/Desktop", type: "folder" },
  { path: `${process.env.HOME ?? "~"}/Documents`, relativePath: "~/Documents", type: "folder" },
  { path: `${process.env.HOME ?? "~"}/Downloads`, relativePath: "~/Downloads", type: "folder" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileMentionToken {
  /** Start index of the @/ or @~ token in the composer text */
  startIndex: number;
  /** End index (cursor position) */
  endIndex: number;
  /** Raw query after the trigger prefix, e.g. "src/comp" */
  query: string;
  /** The trigger prefix detected: "@/" or "@~" */
  trigger: "@/" | "@~";
}

/**
 * Convert a suggestion display path into a canonical mention path body:
 * - absolute: "/foo/bar"
 * - home: "~/foo/bar"
 *
 * If the suggestion omits a leading root marker, fall back to the current
 * token trigger so @~ searches stay in home form and @/ stays absolute form.
 */
export function toMentionPath(
  displayPath: string,
  trigger: "@/" | "@~"
): string {
  const trimmed = displayPath.trim().replace(/\/+$/, "");

  if (trimmed === "~") return "~";
  if (trimmed.startsWith("~/")) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;

  const body = trimmed.replace(/^\/+/, "");
  return trigger === "@~" ? `~/${body}` : `/${body}`;
}

function tokenDirectoryBasePath(token: Pick<FileMentionToken, "query" | "trigger">): string | null {
  if (!token.query.endsWith("/")) return null;

  const body = token.query.replace(/^\/+/, "").replace(/\/+$/, "");
  if (token.trigger === "@~") {
    return body ? `~/${body}` : "~";
  }
  return body ? `/${body}` : "/";
}

/**
 * Resolve a suggestion display path into the final mention path by preserving
 * absolute/home paths and appending relative paths to the active token
 * directory when drilling down.
 */
export function resolveSuggestionMentionPath(
  displayPath: string,
  token: Pick<FileMentionToken, "query" | "trigger">
): string {
  const normalized = toMentionPath(displayPath, token.trigger);
  if (normalized.startsWith("~/") || normalized.startsWith("/")) {
    // If the original display path was relative and we're currently inside a
    // directory token, append relative children under that directory.
    const displayLooksRelative =
      !displayPath.trim().startsWith("~/") &&
      !displayPath.trim().startsWith("/") &&
      displayPath.trim() !== "~";
    const base = displayLooksRelative ? tokenDirectoryBasePath(token) : null;
    if (base) {
      const child = normalized.replace(/^~\/|^\//, "");
      if (base === "~") return `~/${child}`;
      if (base === "/") return `/${child}`;
      return `${base}/${child}`;
    }
  }

  return normalized;
}

/**
 * A file suggestion augmented with folder-specific attachment metadata.
 * For folders, the consumer can present two actions:
 *   1. Mention the folder (lightweight manifest — default)
 *   2. "Attach contents" — inject full recursive tree into context
 */
export interface FileMentionSuggestion extends FileSuggestion {
  /**
   * For folder suggestions: how the folder will be attached.
   * - 'manifest'  (default) — inject lightweight manifest only (name + childCount)
   * - 'contents'            — inject full recursive directory tree
   */
  attachMode?: "manifest" | "contents";
}

export interface UseFileMentionOptions {
  /** Maximum number of suggestions to display in the popover */
  maxSuggestions?: number;
  /** Debounce delay in ms (default: 150) */
  debounceMs?: number;
}

export interface UseFileMentionReturn {
  /** Whether the file suggestion popover should be shown */
  isOpen: boolean;
  /** Current token being edited, or null */
  token: FileMentionToken | null;
  /** Suggestions to display (root hints or search results) */
  suggestions: FileMentionSuggestion[];
  /** Index of the currently highlighted suggestion */
  activeIndex: number;
  /** Whether a search request is in-flight */
  isLoading: boolean;
  /** Last fetch error, if any */
  error: string | null;

  /** Call on every input change */
  handleInput: (text: string, cursorPos: number) => void;
  /** Handle keyboard navigation; returns true if the key was consumed */
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
  /** Select the suggestion at activeIndex (or provide one explicitly) */
  selectSuggestion: (suggestion: FileMentionSuggestion) => {
    text: string;
    startIndex: number;
    endIndex: number;
  } | null;
  /**
   * Drill into a folder suggestion — updates the token query to the folder's
   * path and triggers a new search for its children. Returns the replacement
   * text to inject into the textarea, or null if not applicable.
   */
  drillDown: (suggestion: FileMentionSuggestion) => {
    text: string;
    startIndex: number;
    endIndex: number;
  } | null;
  /** Close the popover without selecting */
  close: () => void;
  /**
   * Switch a folder suggestion to 'contents' mode (full recursive tree).
   * Calling it again is idempotent — once set to contents it stays there
   * until the popover closes.
   */
  onAttachContents: (suggestion: FileMentionSuggestion) => void;
}

// ─── Token detection ──────────────────────────────────────────────────────────

/**
 * Detects a file-mention token (@/ or @~) in composer text at the cursor.
 *
 * Rules:
 * - Token must start at the beginning of text or after whitespace.
 * - The query may contain path characters: letters, digits, /, ~, ., -, _, space not allowed.
 * - Exported for unit testing.
 */
export function detectFileMentionToken(
  text: string,
  cursorPos: number
): FileMentionToken | null {
  if (cursorPos < 2 || cursorPos > text.length) return null;

  // Scan backward from cursor to find the token start
  let tokenStart = cursorPos;
  while (tokenStart > 0 && !/\s/.test(text[tokenStart - 1])) {
    tokenStart--;
  }

  const tokenText = text.slice(tokenStart, cursorPos);

  // Must start with @/ or @~
  if (!tokenText.startsWith("@/") && !tokenText.startsWith("@~")) {
    return null;
  }

  const trigger = tokenText.slice(0, 2) as "@/" | "@~";
  const query = tokenText.slice(2); // everything after @/ or @~

  return { startIndex: tokenStart, endIndex: cursorPos, query, trigger };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFileMention({
  maxSuggestions = 8,
  debounceMs = SEARCH_DEBOUNCE_MS,
}: UseFileMentionOptions = {}): UseFileMentionReturn {
  const [token, setToken] = useState<FileMentionToken | null>(null);
  const [suggestions, setSuggestions] = useState<FileMentionSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AbortController for cancelling stale requests
  const abortRef = useRef<AbortController | null>(null);
  // Debounce timer
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track last query to avoid redundant fetches
  const lastQueryRef = useRef<string | null>(null);

  const isOpen = token !== null;

  // ── Fetch suggestions from /api/file-search ──────────────────────────────

  const fetchSuggestions = useCallback(
    async (query: string, trigger: "@/" | "@~") => {
      // Cancel any in-flight request
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      setError(null);

      try {
        // Directory drill-down: when query ends with /, list the directory contents
        const isDrillDown = query.endsWith("/");
        const effectiveQuery = isDrillDown ? "*" : query;
        const params = new URLSearchParams({ q: effectiveQuery, limit: String(maxSuggestions), includeFolders: "1" });

        if (isDrillDown) {
          // Resolve the directory path as root so the API lists its contents
          const dirPath = trigger === "@~"
            ? `${process.env.HOME ?? "~"}/${query.slice(0, -1)}`
            : `/${query.slice(0, -1)}`;
          params.set("root", dirPath);
        } else if (trigger === "@~") {
          params.set("root", process.env.HOME ?? "~");
        }

        const res = await fetch(`/api/file-search?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        const data = await res.json();
        setSuggestions(
          (data.files as FileSuggestion[]).map((f) => ({
            ...f,
            attachMode: f.type === "folder" ? ("manifest" as const) : undefined,
          }))
        );
        setActiveIndex(0);
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // Stale request cancelled — not an error
          return;
        }
        setError((err as Error).message ?? "Search failed");
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    },
    [maxSuggestions]
  );

  // ── Debounced search trigger ─────────────────────────────────────────────

  const scheduleSearch = useCallback(
    (query: string, trigger: "@/" | "@~") => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);

      if (query === lastQueryRef.current) return; // nothing changed

      if (query.length < MIN_QUERY_FOR_SEARCH) {
        // Show root suggestions immediately — no network call
        if (abortRef.current) {
          abortRef.current.abort();
          abortRef.current = null;
        }
        lastQueryRef.current = query;
        setIsLoading(false);
        setError(null);
        setSuggestions(
          DEFAULT_ROOT_SUGGESTIONS.slice(0, maxSuggestions).map((f) => ({
            ...f,
            attachMode: "manifest" as const,
          }))
        );
        setActiveIndex(0);
        return;
      }

      timerRef.current = setTimeout(() => {
        lastQueryRef.current = query;
        fetchSuggestions(query, trigger);
      }, debounceMs);
    },
    [debounceMs, fetchSuggestions, maxSuggestions]
  );

  // ── Cleanup on unmount ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // ── handleInput ─────────────────────────────────────────────────────────

  const handleInput = useCallback(
    (text: string, cursorPos: number) => {
      const newToken = detectFileMentionToken(text, cursorPos);

      setToken((prev) => {
        const tokenChanged =
          prev?.startIndex !== newToken?.startIndex ||
          prev?.query !== newToken?.query ||
          prev?.trigger !== newToken?.trigger;

        if (tokenChanged && newToken === null) {
          // Token dismissed — cancel pending searches
          if (timerRef.current !== null) clearTimeout(timerRef.current);
          if (abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
          }
          lastQueryRef.current = null;
          setSuggestions([]);
          setIsLoading(false);
          setError(null);
        }

        return newToken;
      });

      if (newToken) {
        scheduleSearch(newToken.query, newToken.trigger);
      }
    },
    [scheduleSearch]
  );

  // ── handleKeyDown ───────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!isOpen || suggestions.length === 0) return false;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => (i < suggestions.length - 1 ? i + 1 : 0));
          return true;

        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => (i > 0 ? i - 1 : suggestions.length - 1));
          return true;

        case "Enter":
          e.preventDefault();
          return true; // Caller handles selection via selectSuggestion(suggestions[activeIndex])

        case "Tab":
          // Do NOT preventDefault — allow Tab to move focus naturally (no focus trap).
          // Return true so the caller knows to accept the active suggestion before Tab moves focus.
          return true;

        case "Escape":
          e.preventDefault();
          setToken(null);
          setSuggestions([]);
          return true;

        default:
          return false;
      }
    },
    [isOpen, suggestions.length]
  );

  // ── selectSuggestion ────────────────────────────────────────────────────

  const selectSuggestion = useCallback(
    (
      suggestion: FileMentionSuggestion
    ): { text: string; startIndex: number; endIndex: number } | null => {
      if (!token) return null;

      // Use relativePath for display (e.g. ~/Code/app) — shorter and readable
      const displayPath = suggestion.relativePath ?? suggestion.path;
      const mentionPath = resolveSuggestionMentionPath(displayPath, token);

      // For folders: suffix with / to signal "this is a directory"
      const trailingSlash = suggestion.type === "folder" ? "/" : "";
      const replacement = `@${mentionPath}${trailingSlash} `;

      setToken(null);
      setSuggestions([]);

      return { text: replacement, startIndex: token.startIndex, endIndex: token.endIndex };
    },
    [token]
  );

  // ── drillDown ──────────────────────────────────────────────────────────

  const drillDown = useCallback(
    (
      suggestion: FileMentionSuggestion
    ): { text: string; startIndex: number; endIndex: number } | null => {
      if (!token || suggestion.type !== "folder") return null;

      const displayPath = suggestion.relativePath ?? suggestion.path;
      const mentionPath = resolveSuggestionMentionPath(displayPath, token);
      const nextTrigger = mentionPath.startsWith("~/") ? "@~" : "@/";
      const nextQueryBase = mentionPath.slice(1);
      const replacement = `@${mentionPath}/`;

      // Update token in place so the popover stays open with the new query
      const newEndIndex = token.startIndex + replacement.length;
      const newQuery = `${nextQueryBase}/`;

      const newToken: FileMentionToken = {
        startIndex: token.startIndex,
        endIndex: newEndIndex,
        query: newQuery,
        trigger: nextTrigger,
      };
      setToken(newToken);

      // Reset cached query so the search fires even if the path was seen before
      lastQueryRef.current = null;
      scheduleSearch(newQuery, nextTrigger);

      return { text: replacement, startIndex: token.startIndex, endIndex: token.endIndex };
    },
    [token, scheduleSearch]
  );

  // ── onAttachContents ─────────────────────────────────────────────────────

  const onAttachContents = useCallback((suggestion: FileMentionSuggestion) => {
    setSuggestions((prev) =>
      prev.map((s) =>
        s.path === suggestion.path ? { ...s, attachMode: "contents" as const } : s
      )
    );
  }, []);

  // ── close ────────────────────────────────────────────────────────────────

  const close = useCallback(() => {
    setToken(null);
    setSuggestions([]);
    setActiveIndex(0);
  }, []);

  return {
    isOpen,
    token,
    suggestions,
    activeIndex,
    isLoading,
    error,
    handleInput,
    handleKeyDown,
    selectSuggestion,
    drillDown,
    close,
    onAttachContents,
  };
}
