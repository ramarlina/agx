"use client";

import { useState, useEffect, useCallback } from "react";
import type { TrackerConnection } from "@/lib/tracker/types";

interface TrackerConnectionInfo {
  type: string;
  connectedAt: string;
  connected: boolean;
  user?: { name: string; email: string } | null;
  metadata?: Record<string, string>;
}

interface UseTrackerConnectionsReturn {
  connections: TrackerConnectionInfo[];
  defaultTracker: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  addConnection: (type: string, metadata?: Record<string, string>) => Promise<{ ok: boolean; error?: string }>;
  removeConnection: (type: string) => Promise<{ ok: boolean; error?: string }>;
  setDefaultTracker: (type: string | null) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Hook to list all tracker connections for a project.
 * Reads from /api/trackers/connections.
 * Used to power sidebar navigation and the connect page.
 */
export function useTrackerConnections(projectId: string | null): UseTrackerConnectionsReturn {
  const [connections, setConnections] = useState<TrackerConnectionInfo[]>([]);
  const [defaultTracker, setDefaultTrackerState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setConnections([]);
      setDefaultTrackerState(null);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/trackers/connections?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setConnections(Array.isArray(data.connections) ? data.connections : []);
      setDefaultTrackerState(typeof data.defaultTracker === "string" ? data.defaultTracker : null);
    } catch {
      setConnections([]);
      setDefaultTrackerState(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addConnection = useCallback(
    async (type: string, metadata?: Record<string, string>) => {
      if (!projectId) return { ok: false, error: "Missing projectId" };
      try {
        const res = await fetch("/api/trackers/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, projectId, metadata }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return { ok: false, error: data.error || "Failed to add connection" };
        }
        await refresh();
        return { ok: true };
      } catch {
        return { ok: false, error: "Failed to add connection" };
      }
    },
    [projectId, refresh]
  );

  const removeConnection = useCallback(
    async (type: string) => {
      if (!projectId) return { ok: false, error: "Missing projectId" };
      try {
        // Use the tracker-specific status DELETE which clears the token and removes
        // from the manifest. The connections DELETE alone is insufficient because the
        // GET endpoint auto-re-registers adapters that still have valid tokens.
        const res = await fetch(
          `/api/trackers/${type}/status?projectId=${encodeURIComponent(projectId)}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return { ok: false, error: data.error || "Failed to remove connection" };
        }
        await refresh();
        return { ok: true };
      } catch {
        return { ok: false, error: "Failed to remove connection" };
      }
    },
    [projectId, refresh]
  );

  const setDefaultTracker = useCallback(
    async (type: string | null) => {
      if (!projectId) return { ok: false, error: "Missing projectId" };
      try {
        const res = await fetch("/api/trackers/connections", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, defaultTracker: type }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return { ok: false, error: data.error || "Failed to set default tracker" };
        }
        await refresh();
        return { ok: true };
      } catch {
        return { ok: false, error: "Failed to set default tracker" };
      }
    },
    [projectId, refresh]
  );

  return { connections, defaultTracker, loading, refresh, addConnection, removeConnection, setDefaultTracker };
}