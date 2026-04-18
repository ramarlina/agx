"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface CliStatus {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
}

type McpStatus = Record<string, boolean>;

interface TrackerConnectionState {
  connected: boolean;
  loading: boolean;
  user: { name: string; email: string } | null;
  clis: CliStatus;
  mcpConfigured: McpStatus;
  connect: () => void;
  connectWithKey: (apiKey: string) => Promise<{ ok: boolean; error?: string }>;
  disconnect: () => Promise<void>;
  configureMcp: (cli: string) => Promise<{ ok: boolean; error?: string }>;
  refresh: () => Promise<boolean>;
}

// Module-level cache shared across all hook instances — 5-minute TTL.
const STATUS_TTL = 5 * 60 * 1000;
type CacheEntry = {
  connected: boolean;
  user: { name: string; email: string } | null;
  clis: CliStatus;
  mcpConfigured: McpStatus;
  ts: number;
};
const statusCache = new Map<string, CacheEntry>();

function getCached(key: string): CacheEntry | null {
  const entry = statusCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > STATUS_TTL) {
    statusCache.delete(key);
    return null;
  }
  return entry;
}

function setCached(key: string, entry: Omit<CacheEntry, "ts">) {
  statusCache.set(key, { ...entry, ts: Date.now() });
}

function bustCache(key: string) {
  statusCache.delete(key);
}

/**
 * Tracker-agnostic connection hook.
 * Replaces useLinearConnection by hitting /api/trackers/[tracker]/status instead of /api/linear/status.
 * Connection status is cached for 5 minutes to avoid re-fetching on every navigation.
 */
export function useTrackerConnection(
  trackerType: string,
  projectId: string
): TrackerConnectionState {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [clis, setClis] = useState<CliStatus>({ claude: false, codex: false, gemini: false });
  const [mcpConfigured, setMcpConfigured] = useState<McpStatus>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const basePath = `/api/trackers/${encodeURIComponent(trackerType)}`;
  const cacheKey = `${trackerType}:${projectId}`;

  const refreshMcp = useCallback(async () => {
    try {
      const res = await fetch(`${basePath}/mcp-setup`);
      const data = await res.json();
      setMcpConfigured(data.configured ?? {});
    } catch {
      // ignore
    }
  }, [basePath]);

  const refresh = useCallback(async () => {
    if (!projectId) {
      // projectId not yet resolved (useProjects still loading) — hold the
      // skeleton until the real ID arrives. Don't set loading: false here.
      setConnected(false);
      return false;
    }

    // Serve from cache if fresh — resolves immediately without a network round-trip.
    const cached = getCached(cacheKey);
    if (cached) {
      setConnected(cached.connected);
      setUser(cached.user);
      setClis(cached.clis);
      setMcpConfigured(cached.mcpConfigured);
      setLoading(false);
      return cached.connected;
    }

    try {
      const query = `?projectId=${encodeURIComponent(projectId)}`;
      const [statusRes, mcpRes] = await Promise.all([
        fetch(`${basePath}/status${query}`),
        fetch(`${basePath}/mcp-setup`),
      ]);
      const statusData = await statusRes.json();
      const mcpData = await mcpRes.json();
      const resolvedClis: CliStatus = statusData.clis ?? { claude: false, codex: false, gemini: false };
      const resolvedMcp: McpStatus = mcpData.configured ?? {};
      const resolvedUser = statusData.user ?? null;

      setConnected(statusData.connected);
      setUser(resolvedUser);
      setClis(resolvedClis);
      setMcpConfigured(resolvedMcp);

      setCached(cacheKey, {
        connected: statusData.connected,
        user: resolvedUser,
        clis: resolvedClis,
        mcpConfigured: resolvedMcp,
      });

      return statusData.connected as boolean;
    } catch {
      setConnected(false);
      return false;
    } finally {
      setLoading(false);
    }
  }, [projectId, basePath, cacheKey]);

  // Reset stale state immediately when tracker type or project changes,
  // before the new fetch (or cache hit) completes.
  useEffect(() => {
    const cached = getCached(cacheKey);
    if (cached) {
      // Apply cached values synchronously so there's no loading flash at all.
      setConnected(cached.connected);
      setUser(cached.user);
      setClis(cached.clis);
      setMcpConfigured(cached.mcpConfigured);
      setLoading(false);
    } else {
      setLoading(true);
      setConnected(false);
      setUser(null);
    }
  }, [trackerType, projectId, cacheKey]);

  useEffect(() => {
    refresh();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh]);

  const connect = useCallback(() => {
    if (!projectId) return;
    bustCache(cacheKey);
    window.open(
      `${basePath}/auth?projectId=${encodeURIComponent(projectId)}`,
      "_blank",
      "noopener"
    );

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      bustCache(cacheKey);
      const isConnected = await refresh();
      if (isConnected && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 2000);
  }, [projectId, basePath, cacheKey, refresh]);

  const connectWithKey = useCallback(
    async (apiKey: string): Promise<{ ok: boolean; error?: string }> => {
      if (!projectId) {
        return { ok: false, error: "Missing projectId" };
      }
      try {
        const res = await fetch(`${basePath}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, accessToken: apiKey }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return { ok: false, error: data.error || "Failed to save token" };
        }
        bustCache(cacheKey);
        await refresh();
        return { ok: true };
      } catch {
        return { ok: false, error: "Failed to connect" };
      }
    },
    [projectId, basePath, cacheKey, refresh]
  );

  const disconnect = useCallback(async () => {
    if (!projectId) return;
    bustCache(cacheKey);
    await fetch(`${basePath}/status?projectId=${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    });
    if (typeof window !== "undefined" && trackerType === "github") {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith("github_"))
        .forEach((k) => sessionStorage.removeItem(k));
    }
    setConnected(false);
    setUser(null);
  }, [projectId, basePath, cacheKey, trackerType]);

  const configureMcp = useCallback(async (cli: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`${basePath}/mcp-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cli }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: false, error: data.error || "Failed to configure MCP" };
      }
      await refreshMcp();
      return { ok: true };
    } catch {
      return { ok: false, error: "Failed to configure MCP" };
    }
  }, [basePath, refreshMcp]);

  return { connected, loading, user, clis, mcpConfigured, connect, connectWithKey, disconnect, configureMcp, refresh };
}
