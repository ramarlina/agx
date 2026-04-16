"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentProcessEntry } from "@/lib/agent-process-registry";
import type { GroupMessage, ChatEvent } from "@/lib/types";
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
 * "who's working" indicator and message delivery.
 *
 * When a chat run is active (queued/running), also opens an SSE
 * connection to `/api/chat-runs/[id]/events` for token-by-token streaming.
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
  // Track active SSE connections by chatRunId
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  // Track per-agent streaming content by chatRunId
  const streamContentRef = useRef<Map<string, Map<string, { text: string; thoughts: string[] }>>>(new Map());

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

  // Clean up SSE connections on unmount
  useEffect(() => {
    return () => {
      for (const es of eventSourcesRef.current.values()) {
        es.close();
      }
      eventSourcesRef.current.clear();
    };
  }, []);

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

        // Streaming state is owned by SSE event handlers — don't reset it here.
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

  // Subscribe to SSE for active chat runs
  useEffect(() => {
    const activeRuns = chatRuns.filter(
      (run) => run.status === "queued" || run.status === "running"
    );
    const activeRunIds = new Set(activeRuns.map((r) => r.chatRunId));

    // Close EventSources for completed/absent runs
    for (const [chatRunId, es] of eventSourcesRef.current.entries()) {
      if (!activeRunIds.has(chatRunId)) {
        es.close();
        eventSourcesRef.current.delete(chatRunId);
        streamContentRef.current.delete(chatRunId);
      }
    }

    // Open EventSources for new active runs
    for (const run of activeRuns) {
      if (eventSourcesRef.current.has(run.chatRunId)) continue;

      const es = new EventSource(`/api/chat-runs/${encodeURIComponent(run.chatRunId)}/events`);
      eventSourcesRef.current.set(run.chatRunId, es);
      const agentContent = new Map<string, { text: string; thoughts: string[] }>();
      streamContentRef.current.set(run.chatRunId, agentContent);

      // Track which agents are actively streaming in this run
      const activeStreamAgents = new Set<string>();

      es.addEventListener("chat", (e) => {
        let event: ChatEvent;
        try {
          event = JSON.parse(e.data);
        } catch {
          return;
        }

        switch (event.type) {
          case "participant-start":
            activeStreamAgents.add(event.participantId);
            if (!agentContent.has(event.participantId)) {
              agentContent.set(event.participantId, { text: "", thoughts: [] });
            }
            break;

          case "text-delta": {
            if (!agentContent.has(event.participantId)) {
              agentContent.set(event.participantId, { text: "", thoughts: [] });
            }
            const entry = agentContent.get(event.participantId);
            if (entry) {
              entry.text += event.delta;
              // Update streaming state with the partial content
              setStreaming((prev) => {
                const updated = { ...prev };
                // Find rootMessageId for this participant
                const rootMessageId = run.rootMessageId ?? null;
                updated[event.participantId] = {
                  content: entry.text,
                  rootMessageId,
                };
                return updated;
              });
            }
            break;
          }

          case "participant-thought": {
            const entry = agentContent.get(event.participantId);
            if (entry) {
              entry.thoughts.push(event.content);
            }
            break;
          }

          case "participant-end":
            activeStreamAgents.delete(event.participantId);
            // When a participant ends, clear their streaming indicator
            setStreaming((prev) => {
              const updated = { ...prev };
              delete updated[event.participantId];
              return updated;
            });
            break;

          case "participant-error":
            activeStreamAgents.delete(event.participantId);
            setStreaming((prev) => {
              const updated = { ...prev };
              delete updated[event.participantId];
              return updated;
            });
            break;

          case "done":
            es.close();
            eventSourcesRef.current.delete(run.chatRunId);
            streamContentRef.current.delete(run.chatRunId);
            break;
        }
      });

      es.onerror = () => {
        es.close();
        eventSourcesRef.current.delete(run.chatRunId);
        streamContentRef.current.delete(run.chatRunId);
      };
    }
  }, [chatRuns]);

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