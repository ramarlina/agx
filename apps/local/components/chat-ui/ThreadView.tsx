"use client";

import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import NextLink from "next/link";
import type { GroupMessage, Participant } from "@/lib/types";
import type { StreamingEntry } from "@/hooks/useGroupChat";
import type { AgentProcessEntry } from "@/lib/agent-process-registry";
import { Markdown } from "./Markdown";
import { Copy, Trash2, User, Link, MessageSquareText, Sparkles } from "lucide-react";
import { ActionToolbar, ActionToolbarDivider } from "../ActionToolbar";
import { IconButton } from "../IconButton";
import { MessageAttachments } from "./MessageAttachments";
import { agentAvatarUrl } from "./ParticipantBar";
import { MessageReactionsBar } from "./MessageReactionsBar";
import { stripMarkers } from "@/lib/chat-utils";
import { StreamingSegments } from "./StreamingSegments";

interface Props {
    messages: GroupMessage[];
    streaming: Record<string, StreamingEntry>;
    participants: Participant[];
    rootMessageId: string;
    queued?: boolean;
    onClose: () => void;
    onCopyThread?: (rootMessageId: string) => void;
    onSummarize?: (rootMessageId: string) => void;
    onAddToChat?: (rootMessageId: string) => void;
    onDeleteThreadRoot?: (messageId: string) => void;
    onDeleteMessage?: (messageId: string) => void;
    highlightedMessageId?: string;
    renderReplyComposer: (rootMessageId: string) => React.ReactNode;
    activeProcesses?: AgentProcessEntry[];
}

export function ThreadView({
    messages,
    streaming,
    participants,
    rootMessageId,
    queued = false,
    onClose,
    onCopyThread,
    onAddToChat,
    onDeleteThreadRoot,
    onDeleteMessage,
    highlightedMessageId,
    renderReplyComposer,
    activeProcesses = [],
}: Props) {
    const bottomRef = useRef<HTMLDivElement>(null);
    const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const participantMap = Object.fromEntries(participants.map((p) => [p.id, p]));

    const threadMessages = useMemo(() => {
        const rootMessage = messages.find((m) => m.id === rootMessageId);
        const replies = messages
            .filter((m) => m.rootMessageId === rootMessageId)
            .sort((a, b) => a.timestamp - b.timestamp);
        return rootMessage ? [rootMessage, ...replies] : replies;
    }, [messages, rootMessageId]);

    const setRef = (id: string, el: HTMLDivElement | null) => {
        if (el) messageRefs.current.set(id, el);
        else messageRefs.current.delete(id);
    };

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const userScrolledUpRef = useRef(false);
    const prevHighlightRef = useRef<string | null>(null);

    // Track whether user has scrolled up
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;
        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            userScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 80;
        };
        container.addEventListener("scroll", handleScroll, { passive: true });
        return () => container.removeEventListener("scroll", handleScroll);
    }, []);

    useEffect(() => {
        if (highlightedMessageId && highlightedMessageId !== prevHighlightRef.current) {
            prevHighlightRef.current = highlightedMessageId;
            const el = messageRefs.current.get(highlightedMessageId);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        } else if (!highlightedMessageId && !userScrolledUpRef.current) {
            prevHighlightRef.current = null;
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [highlightedMessageId, threadMessages, streaming]);

    const formatTimestamp = (ts: number) => {
        return new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        }).format(ts);
    };

    return (
        <div className="flex flex-col h-full overflow-hidden bg-[var(--app-shell-bg)] transition-colors">
            {/* Active processes bar */}
            {activeProcesses.length > 0 && (
                <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-[var(--app-shell-border)] bg-[var(--app-shell-surface)] backdrop-blur-md transition-colors">
                    <div className="inline-flex items-center gap-2 text-[11px] font-medium text-[var(--app-shell-muted)]">
                        <Sparkles className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.75} />
                        <span className="uppercase tracking-[0.16em]">Working</span>
                    </div>
                    <div className="flex items-center -space-x-1.5">
                        {activeProcesses.map((proc) => {
                            const p = participantMap[proc.agentId];
                            return (
                                <div key={proc.agentId} className="relative" title={`${p?.name || proc.agentId} — ${proc.state}`}>
                                    <img
                                        src={agentAvatarUrl(proc.agentId, 24, p?.color)}
                                        alt={p?.name || proc.agentId}
                                        className="w-6 h-6 rounded-full border-2 border-[var(--app-shell-surface)] shadow-sm"
                                    />
                                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-[var(--app-shell-surface)] animate-pulse" />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            {/* Thread Content */}
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 chat-scrollbar">
                <div className="max-w-2xl mx-auto space-y-8 pb-4">

                    {threadMessages.map((msg) => {
                        const isUser = msg.role === "user";
                        const p = msg.participantId ? participantMap[msg.participantId] : null;

                        return (
                            <div
                                key={msg.id}
                                ref={(el) => setRef(msg.id, el)}
                                data-message-id={msg.id}
                                className={`group relative flex gap-4 ${isUser ? "" : ""}`}
                            >
                                <div className="flex-shrink-0 mt-1">
                                    {isUser ? (
                                        <div className="w-9 h-9 bg-[var(--app-shell-subtle)] rounded-full flex items-center justify-center text-[var(--app-shell-muted)] shadow-sm">
                                            <User className="w-5 h-5" />
                                        </div>
                                    ) : (
                                        <NextLink href={`/agents/${p?.id || msg.participantId || "assistant"}`} className="hover:ring-2 hover:ring-[var(--ring)] rounded-full transition-shadow">
                                            <img
                                                src={p ? agentAvatarUrl(p.id, 36, p.color) : agentAvatarUrl(msg.participantId || "assistant", 36)}
                                                alt={p?.name || msg.participantId || "Assistant"}
                                                className="w-9 h-9 rounded-full shadow-sm border border-[var(--app-shell-border)] object-cover bg-[var(--app-shell-subtle)]"
                                            />
                                        </NextLink>
                                    )}
                                </div>

                                <div className="flex-1 space-y-1.5 max-w-full overflow-hidden">
                                    <div className="flex items-center gap-2 mb-2">
                                        {isUser ? (
                                            <span className="font-bold text-sm text-[var(--foreground)]">You</span>
                                        ) : (
                                            <NextLink
                                                href={`/agents/${p?.id || msg.participantId || "assistant"}`}
                                                className="font-bold text-sm text-[var(--foreground)] hover:underline"
                                                style={p?.color ? { color: p.color } : undefined}
                                            >
                                                {p?.name || msg.participantId || "Assistant"}
                                            </NextLink>
                                        )}
                                        {msg.rootMessageId === undefined && msg.id === rootMessageId && (
                                            <span className="text-[10px] px-1.5 py-0.5 bg-[var(--app-shell-elevated)] text-[var(--app-shell-muted)] rounded font-mono uppercase">
                                                ROOT
                                            </span>
                                        )}
                                        <span className="text-[11px] text-[var(--app-shell-soft-text)]">{formatTimestamp(msg.timestamp)}</span>
                                    </div>

                                    <div className={`text-[15px] leading-relaxed ${msg.id === highlightedMessageId ? "ring-2 ring-[var(--ring)] rounded-2xl p-2 -m-2" : ""}`}>
                                        {isUser ? (
                                            <Markdown content={stripMarkers(msg.content)} isUser />
                                        ) : (
                                            <StreamingSegments content={stripMarkers(msg.content)} />
                                        )}
                                        {msg.attachments && msg.attachments.length > 0 && (
                                            <MessageAttachments attachments={msg.attachments} />
                                        )}
                                    </div>
                                    {msg.reactions && msg.reactions.length > 0 && (
                                        <div className="mt-2">
                                            <MessageReactionsBar reactions={msg.reactions} />
                                        </div>
                                    )}

                                    {/* Actions on hover */}
                                    <ActionToolbar>
                                        {msg.id === rootMessageId && (
                                            <IconButton
                                                variant="primary"
                                                size="sm"
                                                onClick={() => navigator.clipboard.writeText(msg.id)}
                                                title="Copy message ID"
                                            >
                                                <Link className="w-3.5 h-3.5" />
                                            </IconButton>
                                        )}
                                        {msg.id === rootMessageId && onCopyThread && (
                                            <IconButton
                                                variant="neutral"
                                                size="sm"
                                                onClick={() => onCopyThread(msg.id)}
                                                title="Copy Thread"
                                            >
                                                <MessageSquareText className="w-3.5 h-3.5" />
                                            </IconButton>
                                        )}
                                        <IconButton
                                            variant="neutral"
                                            size="sm"
                                            onClick={() => navigator.clipboard.writeText(msg.content)}
                                            title="Copy as Markdown"
                                        >
                                            <Copy className="w-3.5 h-3.5" />
                                        </IconButton>
                                        {msg.id === rootMessageId && onDeleteThreadRoot && (
                                            <>
                                                <ActionToolbarDivider />
                                                <IconButton
                                                    variant="destructive"
                                                    size="sm"
                                                    onClick={() => onDeleteThreadRoot(msg.id)}
                                                    title="Delete Thread"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </IconButton>
                                            </>
                                        )}
                                        {msg.id !== rootMessageId && onDeleteMessage && (
                                            <>
                                                <ActionToolbarDivider />
                                                <IconButton
                                                    variant="destructive"
                                                    size="sm"
                                                    onClick={() => onDeleteMessage(msg.id)}
                                                    title="Delete Message"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </IconButton>
                                            </>
                                        )}
                                    </ActionToolbar>
                                </div>
                            </div>
                        );
                    })}

                    {queued && activeProcesses.length === 0 && (
                        <div className="flex gap-3 group relative opacity-80 animate-in fade-in slide-in-from-bottom-1 duration-300">
                            <div className="flex-shrink-0 mt-0.5">
                                <div className="w-7 h-7 rounded-full border border-[var(--app-shell-border)] bg-[var(--app-shell-subtle)] flex items-center justify-center">
                                    <Sparkles className="w-3.5 h-3.5 text-[var(--app-shell-soft-text)]" strokeWidth={1.5} />
                                </div>
                            </div>
                            <div className="flex-1 max-w-full overflow-hidden">
                                <div className="flex items-center gap-2 py-1">
                                    <span className="text-xs tracking-wide text-[var(--app-shell-soft-text)]">Processing</span>
                                    <span className="inline-flex items-center gap-[3px]">
                                        <span className="w-1 h-1 rounded-full bg-[var(--app-shell-soft-text)]/50 animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
                                        <span className="w-1 h-1 rounded-full bg-[var(--app-shell-soft-text)]/50 animate-[pulse-dot_1.4s_ease-in-out_0.2s_infinite]" />
                                        <span className="w-1 h-1 rounded-full bg-[var(--app-shell-soft-text)]/50 animate-[pulse-dot_1.4s_ease-in-out_0.4s_infinite]" />
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Streaming content + typing indicators */}
                    {Object.entries(streaming)
                        .filter(([, entry]) => entry.rootMessageId === rootMessageId)
                        .map(([pid, entry]) => {
                            const sp = participantMap[pid];
                            const hasContent = entry.content.trim().length > 0;
                            const isWorking = activeProcesses.some((p) => p.agentId === pid);
                            return (
                                <div key={`streaming-${pid}`} className="flex gap-4 group relative animate-in fade-in slide-in-from-bottom-2 duration-300">
                                    <div className="flex-shrink-0 mt-1">
                                        <NextLink href={`/agents/${sp?.id || pid}`} className="hover:ring-2 hover:ring-[var(--ring)] rounded-full transition-shadow">
                                            <img
                                                src={sp ? agentAvatarUrl(sp.id, 36, sp.color) : agentAvatarUrl(pid, 36)}
                                                alt={sp?.name || pid}
                                                className="w-9 h-9 rounded-full shadow-sm border border-[var(--app-shell-border)] object-cover bg-[var(--app-shell-subtle)]"
                                            />
                                        </NextLink>
                                    </div>
                                    <div className="flex-1 space-y-1.5 max-w-full overflow-hidden">
                                        <div className="flex items-center gap-2">
                                            <NextLink
                                                href={`/agents/${sp?.id || pid}`}
                                                className="font-bold text-sm text-[var(--foreground)] hover:underline"
                                                style={sp?.color ? { color: sp.color } : undefined}
                                            >
                                                {sp?.name || pid}
                                            </NextLink>
                                            {!hasContent && (
                                                <span className="inline-flex items-center gap-[3px]">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--app-shell-muted)] animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
                                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--app-shell-muted)] animate-[pulse-dot_1.4s_ease-in-out_0.2s_infinite]" />
                                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--app-shell-muted)] animate-[pulse-dot_1.4s_ease-in-out_0.4s_infinite]" />
                                                </span>
                                            )}
                                        </div>
                                        {hasContent && (
                                            <StreamingSegments content={entry.content} thoughts={entry.thoughts} />
                                        )}
                                        {hasContent && isWorking && (
                                            <div className="flex items-center gap-2 pt-1">
                                                <span className="inline-flex items-center gap-[3px]">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--app-shell-muted)] animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
                                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--app-shell-muted)] animate-[pulse-dot_1.4s_ease-in-out_0.2s_infinite]" />
                                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--app-shell-muted)] animate-[pulse-dot_1.4s_ease-in-out_0.4s_infinite]" />
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    <div ref={bottomRef} className="h-4" />
                </div>
            </div>

            {/* Composer Area */}
            <div className="z-20 transition-colors duration-200">
                {renderReplyComposer(rootMessageId)}
            </div>
        </div>
    );
}
