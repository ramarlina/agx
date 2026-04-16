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

/**
 * Tracker-agnostic connection hook.
 * Replaces useLinearConnection by hitting /api/trackers/[tracker]/status instead of /api/linear/status.
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
      setConnected(false);
      setLoading(false);
      return false;
    }
    try {
      const query = `?projectId=${encodeURIComponent(projectId)}`;
      const [statusRes, mcpRes] = await Promise.all([
        fetch(`${basePath}/status${query}`),
        fetch(`${basePath}/mcp-setup`),
      ]);
      const statusData = await statusRes.json();
      const mcpData = await mcpRes.json();
      setConnected(statusData.connected);
      setUser(statusData.user ?? null);
      setClis(statusData.clis ?? { claude: false, codex: false, gemini: false });
      setMcpConfigured(mcpData.configured ?? {});
      return statusData.connected as boolean;
    } catch {
      setConnected(false);
      return false;
    } finally {
      setLoading(false);
    }
  }, [projectId, basePath]);

  useEffect(() => {
    refresh();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh]);

  const connect = useCallback(() => {
    if (!projectId) return;
    // Open OAuth in a new tab
    window.open(
      `${basePath}/auth?projectId=${encodeURIComponent(projectId)}`,
      "_blank",
      "noopener"
    );

    // Poll for connection until successful
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const isConnected = await refresh();
      if (isConnected && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 2000);
  }, [projectId, basePath, refresh]);

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
        await refresh();
        return { ok: true };
      } catch {
        return { ok: false, error: "Failed to connect" };
      }
    },
    [projectId, basePath, refresh]
  );

  const disconnect = useCallback(async () => {
    if (!projectId) return;
    await fetch(`${basePath}/status?projectId=${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    });
    setConnected(false);
    setUser(null);
  }, [projectId, basePath]);

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