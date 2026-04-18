"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NextLink from "next/link";
import type { GroupMessage, Participant, ThreadInfo } from "@/lib/types";
import type { ThreadStatus } from "@/lib/storage/thread-adapter";
import type { StreamingEntry } from "@/hooks/useGroupChat";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";
import { Markdown } from "./Markdown";
import { MessageAttachments } from "./MessageAttachments";
import { ActionToolbar, ActionToolbarDivider } from "../ActionToolbar";
import { IconButton } from "../IconButton";
import { MessageSquare, Copy, Hash, Loader2, Trash2, User, Clock, Zap, CheckCircle2, Circle, Link, AtSign, Rocket, ArrowUpDown, ArrowDown, ArrowUp } from "lucide-react";
import { agentAvatarUrl } from "./ParticipantBar";
import { stripMarkers } from "@/lib/chat-utils";
import { JumpToLatestButton } from "./JumpToLatestButton";


const THREAD_STATUSES: { value: ThreadStatus; label: string; color: string }[] = [
  { value: "active", label: "Active", color: "#f59e0b" },
  { value: "paused", label: "Paused", color: "#f97316" },
  { value: "in-review", label: "In Review", color: "#6b7280" },
  { value: "done", label: "Done", color: "#3b82f6" },
  { value: "archived", label: "Archived", color: "#9ca3af" },
];

const COLLAPSED_STATUSES: Set<ThreadStatus> = new Set(["done", "in-review", "archived"]);

interface Props {
  messages: GroupMessage[];
  streaming: Record<string, StreamingEntry>;
  participants: Participant[];
  onOpenThread?: (rootMessageId: string) => void;
  onCopyThread?: (rootMessageId: string) => void;
  onDeleteThreadRoot?: (rootMessageId: string) => void;
  onSummarize?: (rootMessageId: string) => void;
  onAddToChat?: (rootMessageId: string) => void;
  summarizingThreads?: Set<string>;
  deletingThreadRootId?: string | null;
  highlightedMessageId?: string | null;
  onUpdateMessageThreadStatus?: (messageId: string, status: ThreadStatus) => void;
  onUpdateMessageOutcomeNote?: (messageId: string, note: string) => void;
  shipModeThreads?: Set<string>;
}

interface ThreadData extends ThreadInfo {
  /** All replies for the full view */
  allReplies: GroupMessage[];
}

function buildThreadDataMap(messages: GroupMessage[]): Map<string, ThreadData> {
  const map = new Map<string, ThreadData>();
  for (const msg of messages) {
    const rootId = msg.rootMessageId;
    if (!rootId) continue;
    let data = map.get(rootId);
    if (!data) {
      data = {
        rootMessageId: rootId,
        replyCount: 0,
        participants: [],
        lastActivityAt: 0,
        allReplies: [],
      };
      map.set(rootId, data);
    }
    data.replyCount++;
    data.lastActivityAt = Math.max(data.lastActivityAt, msg.timestamp);
    data.lastReply = msg;
    data.allReplies.push(msg);
    if (msg.participantId && !data.participants.includes(msg.participantId)) {
      data.participants.push(msg.participantId);
    } else if (!msg.participantId && !data.participants.includes("user")) {
      data.participants.push("user");
    }
  }
  for (const data of map.values()) {
    data.allReplies.sort((a, b) => a.timestamp - b.timestamp);
  }
  return map;
}

const SUMMARY_MARKER = "<!-- thread-summary -->";

export function MessageList({
  messages,
  streaming,
  participants,
  onOpenThread,
  onCopyThread,
  onAddToChat,
  onDeleteThreadRoot,
  onSummarize,
  summarizingThreads,
  deletingThreadRootId,
  highlightedMessageId,
  onUpdateMessageThreadStatus,
  onUpdateMessageOutcomeNote,
  shipModeThreads,
}: Props) {
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [statusMenuMessageId, setStatusMenuMessageId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"active" | "paused" | "in-review" | "done" | "archived">("active");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      setShowJumpToLatest(distanceFromBottom > 200);
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  const jumpToLatest = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const target = sortOrder === "asc" ? container.scrollHeight : 0;
    container.scrollTo({ top: target, behavior: "smooth" });
  }, [sortOrder]);
  const participantMap = Object.fromEntries(participants.map((p) => [p.id, p]));

  // Filter to only main chat messages (not thread replies)
  const allMainMessages = useMemo(
    () => {
      const filtered = messages.filter((msg) => !msg.rootMessageId);
      return sortOrder === "asc"
        ? [...filtered].sort((a, b) => a.timestamp - b.timestamp)
        : [...filtered].sort((a, b) => b.timestamp - a.timestamp);
    },
    [messages, sortOrder]
  );

  // Auto-scroll to bottom when newest is at bottom (asc) and new messages arrive
  const prevMessageCountRef = useRef(0);
  useEffect(() => {
    if (sortOrder !== "asc") { prevMessageCountRef.current = allMainMessages.length; return; }
    if (allMainMessages.length > prevMessageCountRef.current) {
      scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: "smooth" });
    }
    prevMessageCountRef.current = allMainMessages.length;
  }, [allMainMessages.length, sortOrder]);

  const TAB_FILTERS: Record<typeof activeTab, Set<ThreadStatus>> = {
    active: new Set(["active"]),
    paused: new Set(["paused"]),
    "in-review": new Set(["in-review"]),
    done: new Set(["done"]),
    archived: new Set(["archived"]),
  };

  const mainMessages = useMemo(
    () => allMainMessages.filter((msg) => TAB_FILTERS[activeTab].has(msg.threadStatus ?? "active")),
    [allMainMessages, activeTab]
  );

  const tabCounts = useMemo(() => ({
    active: allMainMessages.filter((m) => TAB_FILTERS.active.has(m.threadStatus ?? "active")).length,
    paused: allMainMessages.filter((m) => TAB_FILTERS.paused.has(m.threadStatus ?? "active")).length,
    "in-review": allMainMessages.filter((m) => TAB_FILTERS["in-review"].has(m.threadStatus ?? "active")).length,
    done: allMainMessages.filter((m) => TAB_FILTERS.done.has(m.threadStatus ?? "active")).length,
    archived: allMainMessages.filter((m) => TAB_FILTERS.archived.has(m.threadStatus ?? "active")).length,
  }), [allMainMessages]);

  const threadDataMap = useMemo(() => buildThreadDataMap(messages), [messages]);

  const setMessageRef = useCallback((messageId: string, element: HTMLDivElement | null) => {
    if (element) {
      messageRefs.current.set(messageId, element);
      return;
    }
    messageRefs.current.delete(messageId);
  }, []);

  const prevHighlightedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightedMessageId) { prevHighlightedRef.current = null; return; }
    // Only scroll when the highlighted message actually changes
    if (highlightedMessageId === prevHighlightedRef.current) return;
    prevHighlightedRef.current = highlightedMessageId;
    const element = messageRefs.current.get(highlightedMessageId);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedMessageId, messages]);

  const TABS: { key: typeof activeTab; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "paused", label: "Paused" },
    { key: "in-review", label: "In Review" },
    { key: "done", label: "Done" },
    { key: "archived", label: "Archived" },
  ];

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
    <div ref={scrollContainerRef} className="chat-scrollbar flex-1 overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto">
        {allMainMessages.length > 0 && (
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="flex items-center gap-1 p-1 rounded-lg border border-[var(--app-shell-border)] bg-[var(--app-shell-subtle)]">
            {TABS.map((tab) => {
              const count = tabCounts[tab.key];
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                    isActive
                      ? "bg-[var(--app-shell-surface)] text-[var(--foreground)] shadow-sm"
                      : "text-[var(--app-shell-muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {tab.label}
                  {count > 0 && (
                    <span className={`ml-1.5 text-[10px] ${isActive ? "opacity-60" : "opacity-50"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
            </div>
            <button
              type="button"
              onClick={() => setSortOrder((o) => o === "asc" ? "desc" : "asc")}
              title={sortOrder === "asc" ? "Newest at bottom — click to flip" : "Newest at top — click to flip"}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-[var(--app-shell-border)] bg-[var(--app-shell-subtle)] text-[var(--app-shell-muted)] hover:text-[var(--foreground)] text-[10px] font-bold transition-colors"
            >
              {sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              {sortOrder === "asc" ? "Oldest first" : "Newest first"}
            </button>
          </div>
        )}
        {/* Top-level streaming indicators are now rendered inside their triggering message card */}
        {allMainMessages.length === 0 && Object.keys(streaming).length === 0 && (
          <div className="flex flex-col items-center justify-center text-[var(--app-shell-muted)] mt-32 space-y-3">
            <MessageSquare className="h-6 w-6" strokeWidth={1.5} />
            <span className="text-sm font-medium tracking-wide">Start a thread</span>
          </div>
        )}
        {allMainMessages.length > 0 && mainMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center text-[var(--app-shell-muted)] mt-16 space-y-2">
            <span className="text-sm font-medium">No {activeTab} threads</span>
          </div>
        )}
        {mainMessages.map((msg) => {
          const p = msg.participantId ? participantMap[msg.participantId] : null;
          const threadData = threadDataMap.get(msg.id);
          const isDeletingRoot = deletingThreadRootId === msg.id;

          const summaryMsg = threadData?.allReplies.find((r) => r.content.startsWith(SUMMARY_MARKER));
          const summaryText = summaryMsg
            ? summaryMsg.content.slice(SUMMARY_MARKER.length).trim()
            : null;


          const msgStatus = msg.threadStatus ?? "active";
          const isCollapsed = COLLAPSED_STATUSES.has(msgStatus);
          const statusInfo = THREAD_STATUSES.find((s) => s.value === msgStatus) ?? THREAD_STATUSES[0];
          const hasActiveAgents = Object.values(streaming).some((entry) => entry.rootMessageId === msg.id);

          if (isCollapsed) {
            return (
              <div
                key={msg.id}
                ref={(element) => setMessageRef(msg.id, element)}
                data-message-id={msg.id}
                className={`max-w-2xl mx-auto bg-[var(--app-shell-subtle)] rounded-xl border border-[var(--app-shell-border)] mb-3 group transition-all hover:border-[var(--app-shell-border-strong)] relative cursor-pointer ${statusMenuMessageId === msg.id ? 'z-50' : ''}`}
                onClick={() => onOpenThread?.(msg.id)}
              >
                <div className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <Hash className="w-3.5 h-3.5 text-[var(--app-shell-muted)] shrink-0" />
                    <span className="text-sm font-medium text-[var(--app-shell-muted)] truncate flex-1">
                      {stripMarkers(msg.content.split('\n')[0])}
                    </span>
                    {shipModeThreads?.has(msg.id) && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-indigo-500 font-medium shrink-0" title="Ship Mode active">
                        <Rocket size={11} style={{ animation: "shipPulse 2s ease-in-out infinite" }} />
                        Ship
                      </span>
                    )}
                    {hasActiveAgents && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-green-600 font-medium shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        Working
                      </span>
                    )}
                    {msg.outcomeNote && (
                      <span className="text-[11px] text-[var(--app-shell-soft-text)] truncate max-w-[200px]">{msg.outcomeNote}</span>
                    )}
                    <span className="text-[10px] text-[var(--app-shell-soft-text)] shrink-0">
                      {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(msg.timestamp)}
                    </span>
                  {onUpdateMessageThreadStatus && (() => {
                    const isOpen = statusMenuMessageId === msg.id;
                    return (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setStatusMenuMessageId(isOpen ? null : msg.id);
                          }}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border transition-colors hover:bg-[var(--app-shell-elevated)]"
                          style={{ borderColor: statusInfo.color + "40", color: statusInfo.color }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusInfo.color }} />
                          {statusInfo.label}
                        </button>
                        {isOpen && (
                          <div
                            className="absolute top-full right-0 mt-1 z-50 bg-[var(--app-shell-elevated)] border border-[var(--app-shell-border)] rounded-lg shadow-lg p-1 min-w-[8.5rem]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {THREAD_STATUSES.map((s) => (
                              <button
                                key={s.value}
                                type="button"
                                className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${s.value === msgStatus ? "bg-[var(--primary-muted)] text-[var(--primary)]" : "text-[var(--muted-foreground)] hover:bg-[var(--app-shell-subtle)]"}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onUpdateMessageThreadStatus(msg.id, s.value);
                                  setStatusMenuMessageId(null);
                                }}
                              >
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                                {s.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {threadData && threadData.replyCount > 0 && (
                    <span className="text-[10px] text-[var(--app-shell-muted)] shrink-0">{threadData.replyCount} replies</span>
                  )}
                  </div>
                  {summaryText && (
                    <div className="mt-1.5 pl-6 flex flex-col gap-1">
                      <div className="text-sm text-[var(--muted-foreground)] leading-relaxed prose prose-sm prose-neutralmax-w-none">
                        <Markdown content={summaryText} isUser={false} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className={`max-w-2xl mx-auto surface-card mb-6 group relative ${statusMenuMessageId === msg.id ? 'z-50' : ''}`}>
              {(onCopyThread || onAddToChat || onDeleteThreadRoot) && (
                <ActionToolbar className="z-10">
                  {onAddToChat && (
                    <IconButton
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => onAddToChat(msg.id)}
                      title="Mention in chat"
                    >
                      <AtSign className="w-3.5 h-3.5" />
                    </IconButton>
                  )}
                  <IconButton
                    type="button"
                    variant="neutral"
                    size="sm"
                    onClick={() => { navigator.clipboard.writeText(msg.id); }}
                    title="Copy message ID"
                  >
                    <Link className="w-3.5 h-3.5" />
                  </IconButton>
                  {onCopyThread && (
                    <IconButton
                      type="button"
                      variant="neutral"
                      size="sm"
                      onClick={() => onCopyThread(msg.id)}
                      title="Copy thread as markdown"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </IconButton>
                  )}
                  {onDeleteThreadRoot && (
                    <>
                      <ActionToolbarDivider />
                      <IconButton
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => onDeleteThreadRoot(msg.id)}
                        disabled={isDeletingRoot}
                        title="Delete this thread"
                      >
                        {isDeletingRoot ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </IconButton>
                    </>
                  )}
                </ActionToolbar>
              )}
              <div className="flex flex-col">
                <div className="p-5">
                  <div ref={(element) => setMessageRef(msg.id, element)} data-message-id={msg.id} className="flex flex-col">

                    {/* User Info & Title */}
                    <div className="flex gap-3 mb-4">
                      {msg.role !== 'user' && (
                        <NextLink href={`/agents/${p?.id || msg.participantId || "assistant"}`} className="w-10 h-10 rounded-full bg-[var(--app-shell-subtle)] overflow-hidden border border-[var(--app-shell-border)] shadow-sm flex items-center justify-center shrink-0 hover:ring-2 hover:ring-[var(--ring)] transition-shadow">
                          {p ? (
                            <img
                              src={agentAvatarUrl(p.id, 40, p.color)}
                              alt={p.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <img
                              src={agentAvatarUrl(msg.participantId || "assistant", 40)}
                              alt={msg.participantId || "Assistant"}
                              className="w-full h-full object-cover"
                            />
                          )}
                        </NextLink>
                      )}
                      <div className="flex-1 min-w-0 pt-0.5">
                        {msg.role !== 'user' && (
                          <div className="flex items-center gap-2 mb-0.5">
                            <NextLink href={`/agents/${p?.id || msg.participantId || "assistant"}`} className="font-bold text-sm text-[var(--foreground)] hover:underline">
                              {p?.name || msg.participantId || "Assistant"}
                            </NextLink>
                          </div>
                        )}
                        <div
                          className="cursor-pointer group/msg-title mb-1"
                          onClick={() => onOpenThread?.(msg.id)}
                        >
                          <h3 className="text-lg font-bold text-[var(--foreground)] leading-tight group-hover/msg-title:text-[var(--primary)] transition-colors line-clamp-1">
                            {stripMarkers(msg.content.split('\n')[0])}
                          </h3>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-[11px] font-medium text-[var(--app-shell-soft-text)]">
                              {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(msg.timestamp)}
                            </span>
                            {onUpdateMessageThreadStatus && (() => {
                              const isOpen = statusMenuMessageId === msg.id;
                              return (
                                <div className="relative">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setStatusMenuMessageId(isOpen ? null : msg.id);
                                    }}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border transition-colors hover:bg-[var(--app-shell-subtle)]"
                                    style={{ borderColor: statusInfo.color + "40", color: statusInfo.color }}
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusInfo.color }} />
                                    {statusInfo.label}
                                  </button>
                                  {isOpen && (
                                    <div
                                      className="absolute top-full left-0 mt-1 z-50 bg-[var(--app-shell-elevated)] border border-[var(--app-shell-border)] rounded-lg shadow-lg p-1 min-w-[8.5rem]"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {THREAD_STATUSES.map((s) => (
                                        <button
                                          key={s.value}
                                          type="button"
                                          className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${s.value === msgStatus ? "bg-[var(--primary-muted)] text-[var(--primary)]" : "text-[var(--muted-foreground)] hover:bg-[var(--app-shell-subtle)]"}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onUpdateMessageThreadStatus(msg.id, s.value);
                                            setStatusMenuMessageId(null);
                                          }}
                                        >
                                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                                          {s.label}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            {shipModeThreads?.has(msg.id) && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-indigo-500 font-medium" title="Ship Mode active">
                                <Rocket size={11} style={{ animation: "shipPulse 2s ease-in-out infinite" }} />
                                Ship
                              </span>
                            )}
                            {hasActiveAgents && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-green-600 font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                                Working
                              </span>
                            )}
                          </div>
                          {(msg.content.length > 80 || msg.content.includes('\n')) && (
                            <div className="mt-2 text-[15px] text-[var(--muted-foreground)] leading-relaxed line-clamp-3">
                              <Markdown content={stripMarkers(msg.content.split('\n').slice(1).join('\n').trimStart())} isUser={msg.role === 'user'} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className={`mb-4 ${msg.role !== 'user' ? 'ml-[52px]' : ''}`}>
                        <MessageAttachments attachments={msg.attachments} compact />
                      </div>
                    )}

                    {summaryText && (
                      <div className="mb-4 text-sm text-[var(--muted-foreground)] leading-relaxed">
                        <Markdown content={summaryText} isUser={false} />
                      </div>
                    )}

                    {/* Action Pills */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 mt-2 border-t border-[var(--card-border)]">
                      {onSummarize && threadData && threadData.replyCount > 0 && (
                        <button
                          type="button"
                          onClick={() => onSummarize(msg.id)}
                          disabled={summarizingThreads?.has(msg.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--app-shell-subtle)] hover:bg-[var(--item-hover-bg)] text-[var(--foreground)] border border-[var(--card-border)] text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                        >
                          {summarizingThreads?.has(msg.id) ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--muted-foreground)]" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                          )}
                          {summarizingThreads?.has(msg.id) ? "Summarizing\u2026" : "Summarize"}
                        </button>
                      )}

                      {threadData && threadData.replyCount > 0 && onOpenThread && (
                        <div className="ml-auto flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => onOpenThread(msg.id)}>
                          <span className="text-xs text-[var(--muted-foreground)] font-medium">{threadData.replyCount} replies</span>
                          <div className="flex -space-x-2">
                            {threadData.participants.slice(0, 3).map((pid) => {
                              if (pid === 'user') {
                                return (
                                  <div key="user" className="w-6 h-6 rounded-full bg-[var(--app-shell-subtle)] border-2 border-[var(--card-bg)] flex items-center justify-center z-10">
                                    <User className="w-3 h-3 text-[var(--muted-foreground)]" />
                                  </div>
                                );
                              }
                              const tp = participantMap[pid];
                              return tp ? (
                                <img
                                  key={pid}
                                  src={agentAvatarUrl(pid, 24, tp.color)}
                                  alt={tp.name}
                                  className="w-6 h-6 rounded-full border-2 border-[var(--card-bg)] object-cover z-10"
                                />
                              ) : (
                                <div key={pid} className="w-6 h-6 rounded-full bg-[var(--app-shell-subtle)] border-2 border-[var(--card-bg)] z-10" />
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                  </div>
                </div>


                {/* Typing indicators for this thread */}
                {Object.entries(streaming)
                  .filter(([, entry]) => entry.rootMessageId === msg.id)
                  .map(([pid, entry]) => {
                    const sp = participantMap[pid];
                    return (
                      <div key={`streaming-${pid}`} className="px-6 pb-4">
                        <TypingIndicator
                          participantId={pid}
                          participantName={sp?.name || pid}
                          participantColor={sp?.color || "#888"}
                          content={entry.content}
                        />
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}

      </div>
    </div>
    <JumpToLatestButton
      visible={showJumpToLatest && allMainMessages.length > 10}
      onClick={jumpToLatest}
    />
    </div>
  );
}
