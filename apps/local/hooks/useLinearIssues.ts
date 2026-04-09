import { useState, useEffect, useCallback, useRef } from "react";

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string | null;
  status: string;
  assignee: string | null;
  updatedAt: string;
}

interface Filters {
  teamId?: string;
  statuses?: string[];
  search?: string;
  assigneeIds?: string[];
  assignedToMe?: boolean;
  cycleId?: string;
}

interface UseLinearIssuesOptions {
  projectSlug?: string;
  limit?: number;
}

interface UseLinearIssuesReturn {
  issues: LinearIssue[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useLinearIssues(
  filters: Filters,
  enabled = true,
  options: UseLinearIssuesOptions = {}
): UseLinearIssuesReturn {
  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef(cursor);
  const hydratedRef = useRef(false);
  cursorRef.current = cursor;

  useEffect(() => {
    hydratedRef.current = false;
  }, [options.projectSlug]);

  const fetchPage = useCallback(
    async (append: boolean, refresh = false) => {
      if (!enabled) return;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filters.teamId) params.set("teamId", filters.teamId);
        if (filters.statuses?.length) {
          for (const status of filters.statuses) {
            params.append("status", status);
          }
        }
        if (filters.search) params.set("search", filters.search);
        if (filters.assigneeIds?.length) {
          for (const assigneeId of filters.assigneeIds) {
            params.append("assigneeId", assigneeId);
          }
        }
        else if (filters.assignedToMe) params.set("assignedToMe", "true");
        if (filters.cycleId) params.set("cycleId", filters.cycleId);
        if (append && cursorRef.current) params.set("cursor", cursorRef.current);
        if (options.projectSlug) params.set("projectSlug", options.projectSlug);
        if (options.limit) params.set("limit", String(options.limit));
        if (refresh) params.set("refresh", "true");

        const res = await fetch(`/api/linear/issues?${params.toString()}`);
        const data = await res.json();
        const newIssues: LinearIssue[] = data.issues ?? [];

        setIssues((prev) => (append ? [...prev, ...newIssues] : newIssues));
        setCursor(data.pageInfo?.endCursor ?? null);
        setHasMore(data.pageInfo?.hasNextPage ?? false);
        hydratedRef.current = true;
      } catch {
        if (!append) setIssues([]);
      } finally {
        setLoading(false);
      }
    },
    [filters.teamId, filters.statuses, filters.search, filters.assigneeIds, filters.assignedToMe, filters.cycleId, enabled, options.projectSlug, options.limit],
  );

  useEffect(() => {
    setCursor(null);
    void fetchPage(false, !hydratedRef.current);
  }, [fetchPage]);

  const loadMore = useCallback(() => fetchPage(true), [fetchPage]);
  const refresh = useCallback(() => {
    setCursor(null);
    return fetchPage(false, true);
  }, [fetchPage]);

  return { issues, loading, hasMore, loadMore, refresh };
}
