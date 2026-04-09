"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentProcessEntry } from "@/lib/agent-process-registry";
import type { GroupMessage } from "@/lib/types";
import type { ChatRunInfo, StreamingEntry } from "./useGroupChat";

/** Active process states that should show a typing indicator. */
const ACTIVE_STATES = new Set(["spawning", "running"]);

function normalizeChatRuns(value: unknown): ChatRunInfo[] {
  if (!Array.isArray(value)) return [];
  return value
    .map<ChatRunInfo | null>((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const chatRunId =
        typeof row.chatRunId === "string"
          ? row.chatRunId
          : typeof row.id === "string"
            ? row.id
            : null;
      const threadId = typeof row.threadId === "string" ? row.threadId : null;
      const status = typeof row.status === "string" ? row.status : null;
      const rootMessageId =
        typeof row.rootMessageId === "string"
          ? row.rootMessageId
          : row.rootMessageId === null
            ? null
            : null;

      if (!chatRunId || !threadId || !status) return null;
      if (
        status !== "queued" &&
        status !== "running" &&
        status !== "awaiting_user" &&
        status !== "blocked" &&
        status !== "completed" &&
        status !== "failed" &&
        status !== "cancelled"
      ) {
        return null;
      }

      return {
        chatRunId,
        threadId,
        rootMessageId,
        status,
        optimistic: false,
      };
    })
    .filter((entry): entry is ChatRunInfo => Boolean(entry));
}

/**
 * Polls `/api/processes` and `/api/history?since=` to drive both the
 * "who's working" indicator and message delivery (replacing SSE).
 */
export function useProcessPolling(
  scope: { workspaceId?: string | null; threadId?: string | null } | null,
  options?: {
    intervalMs?: number;
    idleIntervalMs?: number;
    messages?: GroupMessage[];
    setMessages?: React.Dispatch<React.SetStateAction<GroupMessage[]>>;
  }
) {
  const busyIntervalMs = options?.intervalMs ?? 1500;
  const idleIntervalMs = options?.idleIntervalMs ?? 10000;
  const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set());
  const [processes, setProcesses] = useState<AgentProcessEntry[]>([]);
  const [streaming, setStreaming] = useState<Record<string, StreamingEntry>>({});
  const [chatRuns, setChatRuns] = useState<ChatRunInfo[]>([]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const messagesRef = useRef(options?.messages ?? []);
  messagesRef.current = options?.messages ?? [];
  const setMessagesRef = useRef(options?.setMessages);
  setMessagesRef.current = options?.setMessages;
  // Track the latest timestamp we've seen so far for delta fetching
  const lastTimestampRef = useRef<number>(0);

  // Reset lastTimestamp when messages change externally (e.g. full reload)
  useEffect(() => {
    const msgs = options?.messages ?? [];
    if (msgs.length > 0) {
      const maxTs = Math.max(...msgs.map((m) => m.timestamp));
      if (maxTs > lastTimestampRef.current) {
        lastTimestampRef.current = maxTs;
      }
    }
  }, [options?.messages]);

  const poll = useCallback(async () => {
    const s = scopeRef.current;
    if (!s) {
      setActiveAgents(new Set());
      setProcesses([]);
      setStreaming({});
      setChatRuns([]);
      return;
    }

    let processUrl: string | null = null;
    if (s.threadId) {
      processUrl = `/api/processes?threadId=${encodeURIComponent(s.threadId)}`;
    } else if (s.workspaceId) {
      processUrl = `/api/processes?workspaceId=${encodeURIComponent(s.workspaceId)}`;
    }

    if (!processUrl) {
      setActiveAgents(new Set());
      setProcesses([]);
      setStreaming({});
      setChatRuns([]);
      return;
    }

    try {
      // Fetch processes and new messages in parallel
      const historyThreadId = s.workspaceId || s.threadId;
      const historyUrl = historyThreadId
        ? `/api/history?threadId=${encodeURIComponent(historyThreadId)}&since=${lastTimestampRef.current}`
        : null;

      const chatRunsUrl = historyThreadId
        ? `/api/chat-runs?threadId=${encodeURIComponent(historyThreadId)}&limit=20`
        : null;

      const fetches: Promise<Response>[] = [fetch(processUrl)];
      if (historyUrl) fetches.push(fetch(historyUrl));
      if (chatRunsUrl) fetches.push(fetch(chatRunsUrl));

      const [processRes, historyRes, chatRunsRes] = await Promise.all(fetches);

      // Stale check
      const current = scopeRef.current;
      if (current?.threadId !== s.threadId || current?.workspaceId !== s.workspaceId) return;

      // Update processes
      if (processRes.ok) {
        const entries: AgentProcessEntry[] = await processRes.json();
        setProcesses(entries);
        const activeIds = new Set(
          entries.filter((e) => ACTIVE_STATES.has(e.state)).map((e) => e.agentId)
        );
        setActiveAgents(activeIds);

        // Build streaming indicators from active processes
        const newStreaming: Record<string, StreamingEntry> = {};
        for (const proc of entries) {
          if (!ACTIVE_STATES.has(proc.state)) continue;
          const triggerMsg = messagesRef.current.find((m) => m.id === proc.sinceMessageId);
          const rootId = triggerMsg?.rootMessageId ?? proc.sinceMessageId;
          newStreaming[proc.agentId] = { content: "", rootMessageId: rootId };
        }
        setStreaming(newStreaming);
      }

      if (chatRunsRes?.ok) {
        const runs = normalizeChatRuns(await chatRunsRes.json());
        setChatRuns(runs);
      }

      // Merge new messages
      if (historyRes?.ok && setMessagesRef.current) {
        const newMessages: GroupMessage[] = await historyRes.json();
        if (newMessages.length > 0) {
          const maxTs = Math.max(...newMessages.map((m) => m.timestamp));
          if (maxTs > lastTimestampRef.current) {
            lastTimestampRef.current = maxTs;
          }
          setMessagesRef.current((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const toAdd = newMessages.filter((m) => !existingIds.has(m.id));
            // Also update any existing messages (e.g. reactions changed)
            const updated = prev.map((existing) => {
              const fresh = newMessages.find((m) => m.id === existing.id);
              return fresh ?? existing;
            });
            if (toAdd.length === 0) return updated;
            return [...updated, ...toAdd].sort((a, b) => a.timestamp - b.timestamp);
          });
        }
      }
    } catch {
      // network error — keep previous state
    }
  }, []);

  const key = scope?.threadId || scope?.workspaceId || null;
  const hasActiveChatRuns = chatRuns.some((run) => run.status === "queued" || run.status === "running");
  const hasActiveProcesses = processes.some((process) => ACTIVE_STATES.has(process.state));
  const pollIntervalMs = hasActiveChatRuns || hasActiveProcesses ? busyIntervalMs : idleIntervalMs;

  useEffect(() => {
    if (!key) {
      setActiveAgents(new Set());
      setProcesses([]);
      setStreaming({});
      setChatRuns([]);
      return;
    }

    poll();
    const id = setInterval(poll, pollIntervalMs);
    return () => clearInterval(id);
  }, [key, pollIntervalMs, poll]);

  return { activeAgents, processes, streaming, chatRuns, poll };
}
