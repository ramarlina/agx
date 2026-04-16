"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { TrackerItem, TrackerStatusCategory, TrackerFilters } from "@/lib/tracker/types";

interface UseTrackerItemsFilters {
  statusCategories?: TrackerStatusCategory[];
  assigneeIds?: string[];
  groupIds?: string[];
  search?: string;
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

  const fetchPage = useCallback(
    async (append: boolean) => {
      if (!enabled || !options.projectId) return;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("projectId", options.projectId);
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
        if (append && cursorRef.current) params.set("cursor", cursorRef.current);
        if (options.limit) params.set("limit", String(options.limit));

        const res = await fetch(`${basePath}?${params.toString()}`);
        const data = await res.json();
        const newItems: TrackerItem[] = data.items ?? [];

        setItems((prev) => (append ? [...prev, ...newItems] : newItems));
        setCursor(data.pageInfo?.endCursor ?? null);
        setHasMore(data.pageInfo?.hasNextPage ?? false);
        hydratedRef.current = true;
      } catch {
        if (!append) setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [basePath, filters.statusCategories, filters.search, filters.assigneeIds, filters.groupIds, enabled, options.projectId, options.limit]
  );

  useEffect(() => {
    setCursor(null);
    void fetchPage(false);
  }, [fetchPage]);

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