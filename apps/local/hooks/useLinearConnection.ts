// TODO(multi-tracker): This hook manages the Linear OAuth/API-key connection.
// Abstraction path: rename to `useTrackerConnection(trackerType: 'linear' | 'jira' | ...)`.
// Each tracker type maps to its own `/api/<tracker>/status`, `/api/<tracker>/auth`, and
// `/api/<tracker>/token` routes. The returned interface (connected, user, connect, disconnect,
// configureMcp) stays the same — only the endpoints change.

import { useState, useEffect, useCallback, useRef } from "react";

interface CliStatus {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
}

type McpStatus = Record<string, boolean>;

interface LinearConnectionState {
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

export function useLinearConnection(projectId: string): LinearConnectionState {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [clis, setClis] = useState<CliStatus>({ claude: false, codex: false, gemini: false });
  const [mcpConfigured, setMcpConfigured] = useState<McpStatus>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshMcp = useCallback(async () => {
    try {
      const res = await fetch("/api/linear/mcp-setup");
      const data = await res.json();
      setMcpConfigured(data.configured ?? {});
    } catch {
      // ignore
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setConnected(false);
      setLoading(false);
      return false;
    }
    try {
      const query = `?projectId=${encodeURIComponent(projectId)}`;
      const [statusRes, mcpRes] = await Promise.all([
        fetch(`/api/linear/status${query}`),
        fetch("/api/linear/mcp-setup"),
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
  }, [projectId]);

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
      `/api/linear/auth?projectId=${encodeURIComponent(projectId)}`,
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
  }, [projectId, refresh]);

  const connectWithKey = useCallback(
    async (apiKey: string): Promise<{ ok: boolean; error?: string }> => {
      if (!projectId) {
        return { ok: false, error: "Missing projectId" };
      }
      try {
        const res = await fetch("/api/linear/token", {
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
    [projectId, refresh]
  );

  const disconnect = useCallback(async () => {
    if (!projectId) return;
    await fetch(`/api/linear/status?projectId=${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    });
    setConnected(false);
    setUser(null);
  }, [projectId]);

  const configureMcp = useCallback(async (cli: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch("/api/linear/mcp-setup", {
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
  }, [refreshMcp]);

  return { connected, loading, user, clis, mcpConfigured, connect, connectWithKey, disconnect, configureMcp, refresh };
}
