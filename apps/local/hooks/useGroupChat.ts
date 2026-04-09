"use client";

import { useState, useCallback, useRef } from "react";
import type { GroupMessage } from "@/lib/types";
import type { ComposerRoutingMetadata } from "@/lib/chat/composer-routing";

export interface LogEntry {
  timestamp: number;
  participantId: string;
  stream: "stdout" | "stderr";
  line: string;
}

function buildThreadQuery(threadId: string): string {
  return `threadId=${encodeURIComponent(threadId)}`;
}

function buildLogsQuery(workspaceId: string): string {
  return `workspaceId=${encodeURIComponent(workspaceId)}`;
}

export interface StreamingEntry {
  content: string;
  rootMessageId: string | null;
}

export interface ChatRunInfo {
  chatRunId: string;
  threadId: string;
  rootMessageId: string | null;
  status: "queued" | "running" | "awaiting_user" | "blocked" | "completed" | "failed" | "cancelled";
  optimistic?: boolean;
  enqueuedAt?: number;
}

export function useGroupChat(threadId: string | null) {
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [chatRuns, setChatRuns] = useState<ChatRunInfo[]>([]);
  const threadIdRef = useRef<string | null>(threadId);
  const prevThreadIdRef = useRef<string | null>(threadId);

  // Update synchronously during render so sendMessage always sees the current value.
  threadIdRef.current = threadId;

  // Reset state only when threadId actually changes (not on every render).
  if (prevThreadIdRef.current !== threadId) {
    prevThreadIdRef.current = threadId;
    setMessages([]);
    setLogs([]);
    setChatRuns([]);
  }

  const loadHistory = useCallback(async (threadIdOverride?: string | null) => {
    const activeThreadId = threadIdOverride?.trim() || threadIdRef.current?.trim();
    if (!activeThreadId) {
      setMessages([]);
      setLogs([]);
      return;
    }

    const query = buildThreadQuery(activeThreadId);

    try {
      const [histRes, logsRes] = await Promise.all([
        fetch(`/api/history?${query}`),
        fetch(`/api/logs?${buildLogsQuery(activeThreadId)}`),
      ]);

      if (threadIdRef.current !== activeThreadId) {
        return;
      }

      if (histRes.ok) setMessages(await histRes.json());
      if (logsRes.ok) setLogs(await logsRes.json());
    } catch {
      // ignore
    }
  }, []);

  const clearHistory = useCallback(async (threadIdOverride?: string | null) => {
    const activeThreadId = threadIdOverride?.trim() || threadIdRef.current?.trim();
    if (!activeThreadId) {
      setMessages([]);
      setLogs([]);
      return;
    }

    const query = buildThreadQuery(activeThreadId);

    await Promise.all([
      fetch(`/api/history?${query}`, { method: "DELETE" }),
      fetch(`/api/logs?${buildLogsQuery(activeThreadId)}`, { method: "DELETE" }),
    ]);

    if (threadIdRef.current !== activeThreadId) {
      return;
    }

    setMessages([]);
    setLogs([]);
  }, []);

  const sendMessage = useCallback(
    async (
      prompt: string,
      maxRounds: number = 10,
      threadIdOverride?: string | null,
      rootMessageId?: string | null,
      attachmentIds?: string[],
      attachmentMetas?: import("@/lib/types").Attachment[],
      activeParticipantIds?: string[],
      projectSlug?: string,
      promptPrefix?: string,
      routing?: ComposerRoutingMetadata
    ) => {
      const activeThreadId = threadIdOverride?.trim() || threadIdRef.current?.trim();
      if (!activeThreadId) {
        return;
      }

      // Display the clean user text in the chat thread
      const now = Date.now();
      const userMessageId = crypto.randomUUID();
      const userMsg: GroupMessage = {
        id: userMessageId,
        role: "user",
        participantId: null,
        content: prompt,
        timestamp: now,
        rootMessageId: rootMessageId || null,
        parentMessageId: rootMessageId || null,
        depth: rootMessageId ? 1 : 0,
        ...(attachmentMetas && attachmentMetas.length > 0 ? { attachments: attachmentMetas } : {}),
      };
      setMessages((prev) => [...prev, userMsg]);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: activeThreadId,
            prompt,
            promptPrefix: promptPrefix || undefined,
            maxRounds,
            userMessageId,
            rootMessageId: rootMessageId || undefined,
            attachmentIds: attachmentIds?.length ? attachmentIds : undefined,
            activeParticipantIds: Array.isArray(activeParticipantIds) ? activeParticipantIds : undefined,
            projectSlug: projectSlug?.trim() || undefined,
            routing,
          }),
        });
        const payload = await response.json().catch((err) => { console.warn('[useGroupChat] failed to parse run response:', err); return null; }) as { chatRunId?: string } | null;
        if (response.ok && payload?.chatRunId) {
          setChatRuns((prev) => [
            {
              chatRunId: payload.chatRunId!,
              threadId: activeThreadId,
              rootMessageId: rootMessageId || userMessageId,
              status: "queued",
              optimistic: true,
              enqueuedAt: Date.now(),
            },
            ...prev.filter((run) => run.chatRunId !== payload.chatRunId),
          ]);
        }
      } catch {
        // network error — message was already added optimistically
      }

      return userMessageId;
    },
    []
  );

  const stop = useCallback(async () => {
    // Kill active agent processes via API
    const tid = threadIdRef.current?.trim();
    if (tid) {
      try {
        await fetch(`/api/processes?workspaceId=${encodeURIComponent(tid)}`, { method: "DELETE" });
      } catch {
        // ignore
      }
    }
  }, []);

  const stopThread = useCallback(async (rootMessageId: string) => {
    const tid = threadIdRef.current?.trim();
    if (tid) {
      try {
        await fetch(`/api/processes?workspaceId=${encodeURIComponent(tid)}&threadId=${encodeURIComponent(rootMessageId)}`, { method: "DELETE" });
      } catch {
        // ignore
      }
    }
  }, []);

  const clearLogs = useCallback(async (threadIdOverride?: string | null) => {
    const activeThreadId = threadIdOverride?.trim() || threadIdRef.current?.trim();
    if (!activeThreadId) {
      setLogs([]);
      return;
    }

    await fetch(`/api/logs?${buildLogsQuery(activeThreadId)}`, { method: "DELETE" }).catch((err) => console.warn('[useGroupChat] delete logs failed:', err));

    if (threadIdRef.current !== activeThreadId) {
      return;
    }

    setLogs([]);
  }, []);

  return {
    messages,
    setMessages,
    logs,
    sendMessage,
    loadHistory,
    clearHistory,
    clearLogs,
    chatRuns,
    setChatRuns,
    stop,
    stopThread,
  };
}
