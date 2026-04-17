"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { TrackerItem, TrackerStatusCategory, TrackerFilters } from "@/lib/tracker/types";
import { buildCacheKey, readCachedItems, writeCachedItems } from "@/state/trackerItemsCache";

interface UseTrackerItemsFilters {
  statuses?: string[];
  statusCategories?: TrackerStatusCategory[];
  assigneeIds?: string[];
  groupIds?: string[];
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  hasActivity?: boolean;
}

interface UseTrackerItemsOptions {
  projectId: string;
  limit?: number;
}

interface UseTrackerItemsReturn {
  items: TrackerItem[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  updateItem: (item: TrackerItem) => void;
}

/**
 * Tracker-agnostic items hook.
 * Replaces useLinearIssues by fetching from /api/trackers/[tracker]/items.
 */
export function useTrackerItems(
  trackerType: string,
  filters: UseTrackerItemsFilters,
  enabled: boolean,
  options: UseTrackerItemsOptions
): UseTrackerItemsReturn {
  const [items, setItems] = useState<TrackerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef(cursor);
  const hydratedRef = useRef(false);
  cursorRef.current = cursor;

  const basePath = `/api/trackers/${encodeURIComponent(trackerType)}/items`;

  const cacheKey = options.projectId
    ? buildCacheKey(trackerType, options.projectId, {
        statuses: filters.statuses,
        statusCategories: filters.statusCategories,
        search: filters.search,
        assigneeIds: filters.assigneeIds,
        groupIds: filters.groupIds,
        sortBy: filters.sortBy,
        sortDir: filters.sortDir,
        hasActivity: filters.hasActivity,
        limit: options.limit,
      })
    : null;
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  const fetchPage = useCallback(
    async (append: boolean) => {
      if (!enabled || !options.projectId) return;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("projectId", options.projectId);
        if (filters.statuses?.length) {
          for (const s of filters.statuses) {
            params.append("status", s);
          }
        }
        if (filters.statusCategories?.length) {
          for (const cat of filters.statusCategories) {
            params.append("statusCategory", cat);
          }
        }
        if (filters.search) params.set("search", filters.search);
        if (filters.assigneeIds?.length) {
          for (const assigneeId of filters.assigneeIds) {
            params.append("assigneeId", assigneeId);
          }
        }
        if (filters.groupIds?.length) {
          for (const groupId of filters.groupIds) {
            params.append("groupId", groupId);
          }
        }
        if (filters.sortBy) params.set("sortBy", filters.sortBy);
        if (filters.sortDir) params.set("sortDir", filters.sortDir);
        if (filters.hasActivity) params.set("hasActivity", "true");
        if (append && cursorRef.current) params.set("cursor", cursorRef.current);
        if (options.limit) params.set("limit", String(options.limit));

        const res = await fetch(`${basePath}?${params.toString()}`);
        const data = await res.json();
        const newItems: TrackerItem[] = data.items ?? [];

        setItems((prev) => (append ? [...prev, ...newItems] : newItems));
        const endCursor = data.pageInfo?.endCursor ?? null;
        const hasNextPage = data.pageInfo?.hasNextPage ?? false;
        setCursor(endCursor);
        setHasMore(hasNextPage);
        hydratedRef.current = true;

        if (!append && cacheKeyRef.current) {
          void writeCachedItems(cacheKeyRef.current, {
            items: newItems,
            endCursor,
            hasNextPage,
            savedAt: Date.now(),
          });
        }
      } catch {
        if (!append) setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [basePath, filters.statuses, filters.statusCategories, filters.search, filters.assigneeIds, filters.groupIds, filters.sortBy, filters.sortDir, filters.hasActivity, enabled, options.projectId, options.limit]
  );

  useEffect(() => {
    let cancelled = false;
    setCursor(null);
    hydratedRef.current = false;

    if (enabled && cacheKey) {
      void readCachedItems(cacheKey).then((cached) => {
        if (cancelled || !cached) return;
        if (hydratedRef.current) return;
        setItems(cached.items);
        setCursor(cached.endCursor);
        setHasMore(cached.hasNextPage);
        setLoading(false);
      });
    }

    void fetchPage(false);
    return () => {
      cancelled = true;
    };
  }, [fetchPage, cacheKey, enabled]);

  const loadMore = useCallback(() => fetchPage(true), [fetchPage]);
  const refresh = useCallback(() => {
    setCursor(null);
    return fetchPage(false);
  }, [fetchPage]);

  const updateItem = useCallback((item: TrackerItem) => {
    setItems((previous) =>
      previous.map((entry) => (entry.id === item.id ? item : entry))
    );
  }, []);

  return { items, loading, hasMore, loadMore, refresh, updateItem };
}