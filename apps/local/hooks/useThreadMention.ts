import { useState, useCallback, useRef, useEffect } from "react";
import type { GroupMessage, Participant } from "@/lib/types";
import type { ThreadRef } from "@/lib/thread-export";

export interface Discussion {
  rootMessageId: string;
  title: string;
  rootMessage: GroupMessage;
  replies: GroupMessage[];
  participantIds: string[];
  lastActivityAt: number;
}

interface UseThreadMentionProps {
  messages: GroupMessage[];
  maxSuggestions?: number;
}

export function useThreadMention({ messages, maxSuggestions = 5 }: UseThreadMentionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<Discussion[]>([]);

  // Token tracking
  const [matchStart, setMatchStart] = useState<number | null>(null);

  // Filter root messages to find discussions
  const discussions = useRef<Discussion[]>([]);

  // Refresh discussions list when messages change
  useEffect(() => {
    const roots = messages.filter((m) => !m.rootMessageId);
    const replyMap = new Map<string, GroupMessage[]>();
    
    messages.forEach((m) => {
      if (m.rootMessageId) {
        const list = replyMap.get(m.rootMessageId) || [];
        list.push(m);
        replyMap.set(m.rootMessageId, list);
      }
    });

    discussions.current = roots.map((root) => {
      const replies = replyMap.get(root.id) || [];
      const allMsgs = [root, ...replies];
      const lastActivityAt = Math.max(...allMsgs.map(m => m.timestamp));
      // Simple title extraction
      const title = root.content.slice(0, 60).replace(/\n/g, " ").trim() || "Untitled";
      const participantIds = [...new Set(allMsgs.map(m => m.participantId || "user"))];

      return {
        rootMessageId: root.id,
        title,
        rootMessage: root,
        replies,
        participantIds,
        lastActivityAt
      };
    }).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }, [messages]);

  const handleInput = useCallback((text: string, cursorPos: number) => {
    // Regex for @#trigger
    // Look for @# followed by characters until cursor
    const textBeforeCursor = text.slice(0, cursorPos);
    const match = textBeforeCursor.match(/@#([^@#\s]*)$/);

    if (match) {
      setIsOpen(true);
      const q = match[1].toLowerCase();
      setQuery(q);
      setMatchStart(match.index!);
      setActiveIndex(0);

      const filtered = discussions.current.filter((d) => 
        d.title.toLowerCase().includes(q)
      ).slice(0, maxSuggestions);
      
      setSuggestions(filtered);
    } else {
      setIsOpen(false);
      setMatchStart(null);
    }
  }, [maxSuggestions]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || suggestions.length === 0) return false;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      return true;
    }
    return false;
  }, [isOpen, suggestions.length]);

  const selectSuggestion = useCallback((suggestion: Discussion) => {
    if (matchStart === null) return null;
    return {
      startIndex: matchStart,
      endIndex: matchStart + 2 + query.length, // @# + query
      text: "", // Handled by caller inserting node
    };
  }, [matchStart, query]);

  const close = useCallback(() => {
    setIsOpen(false);
    setMatchStart(null);
  }, []);

  const exportDiscussion = useCallback(async (discussion: Discussion): Promise<ThreadRef> => {
    // Need to fetch participants to map names (passed in composer context or fetch fresh)
    // For now assuming we can just use IDs or user/assistant roles, or fetch participants in the hook
    // But hooks shouldn't be async in that way usually.
    // The export API needs participants. We can fetch them or pass them if available.
    // Let's fetch them in this function.
    
    let participants: Participant[] = [];
    try {
      const res = await fetch("/api/participants");
      if (res.ok) {
        participants = await res.json();
      }
    } catch (e) {
      console.warn("Failed to fetch participants for export", e);
    }

    const res = await fetch("/api/thread-export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootMessageId: discussion.rootMessageId,
        title: discussion.title,
        messages: [discussion.rootMessage, ...discussion.replies],
        participants
      })
    });

    if (!res.ok) {
      throw new Error(`Export failed: ${await res.text()}`);
    }

    return await res.json() as ThreadRef;
  }, []);

  return {
    isOpen,
    suggestions,
    activeIndex,
    handleInput,
    handleKeyDown,
    selectSuggestion,
    close,
    exportDiscussion
  };
}