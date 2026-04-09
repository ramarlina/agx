"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchFileMentionResults,
  FileSearchResult,
  FileMentionSearchOptions,
} from "@/lib/chat/fileMentionSearch";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 150;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseFileMentionSearchReturn {
  /** Ranked search results for the current query */
  results: FileSearchResult[];
  /** True while a fetch is in-flight */
  loading: boolean;
  /** Error message from last failed fetch, or null */
  error: string | null;
  /** Clear results and reset internal state */
  reset: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useFileMentionSearch — accepts a query string and returns ranked file/folder
 * results with type, relativePath, and lastModified metadata.
 *
 * - Empty query immediately returns [] without fetching.
 * - Results are debounced (150 ms) and cancelled on query change.
 * - Exposes a reset() to clear state when the popover closes.
 *
 * @example
 * const { results, loading, error, reset } = useFileMentionSearch(query, { limit: 8 });
 */
export function useFileMentionSearch(
  query: string,
  options: FileMentionSearchOptions = {}
): UseFileMentionSearchReturn {
  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setResults([]);
    setLoading(false);
    setError(null);
  }, []);

  useEffect(() => {
    // Empty query → clear immediately
    if (!query) {
      reset();
      return;
    }

    // Cancel previous timer and in-flight request
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    timerRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);

      try {
        const ranked = await fetchFileMentionResults(
          query,
          options,
          controller.signal
        );
        setResults(ranked);
      } catch (err) {
        if ((err as Error).name === "AbortError") return; // stale request
        setError((err as Error).message ?? "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
    // options is intentionally spread inline by caller — only re-run on query change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return { results, loading, error, reset };
}
