import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { threadService } from "@/services/threadService";
import type { SaveThreadInput, Thread, ThreadStatus } from "@/lib/storage";
import type { GroupMessage } from "@/lib/types";
import {
  clearLastThreadId,
  loadLastThreadId,
  persistLastThreadId,
  resolveInitialThreadSelection,
} from "@/state/threadSelection";

const sortByCreatedAt = (threads: Thread[]) =>
  [...threads].sort((a, b) => b.createdAt - a.createdAt);

export function useThreadState(initialThreadId?: string) {
  const searchParams = useSearchParams();
  const isMounted = useRef(true);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoringActiveThread, setIsRestoringActiveThread] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const hasHydratedActiveThreadRef = useRef(false);

  const selectThread = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
  }, []);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const routeThreadId = (initialThreadId || searchParams.get("thread") || "").trim() || null;
        let fetched = await threadService.listThreads();
        if (routeThreadId && !fetched.some((thread) => thread.id === routeThreadId)) {
          const placeholder = await threadService.createThread({ id: routeThreadId });
          fetched = sortByCreatedAt([
            ...fetched.filter((thread) => thread.id !== placeholder.id),
            placeholder,
          ]);
        }
        if (cancelled || !isMounted.current) return;
        setThreads(fetched);
        const urlThreadId = routeThreadId;
        const savedThreadId = urlThreadId || loadLastThreadId();
        const { threadId: resolvedThreadId, shouldClearSavedId, restoredFromStorage } =
          resolveInitialThreadSelection(fetched, savedThreadId);
        if (shouldClearSavedId) {
          clearLastThreadId();
        }
        if (!hasHydratedActiveThreadRef.current) {
          hasHydratedActiveThreadRef.current = true;
        }
        if (restoredFromStorage && resolvedThreadId) {
          selectThread(resolvedThreadId);
        } else if (resolvedThreadId) {
          setActiveThreadId((prev) => prev ?? resolvedThreadId);
        } else {
          setActiveThreadId(null);
        }
      } catch (error) {
        console.error("Failed to load threads", error);
      } finally {
        if (isMounted.current) {
          setIsLoading(false);
          setIsRestoringActiveThread(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectThread, searchParams, initialThreadId]);

  useEffect(() => {
    if (!hasHydratedActiveThreadRef.current) {
      return;
    }

    if (activeThreadId) {
      persistLastThreadId(activeThreadId);
    } else {
      clearLastThreadId();
    }
  }, [activeThreadId]);

  const createThread = useCallback(
    async (input?: Partial<Pick<SaveThreadInput, "id" | "title" | "messages" | "metadata">>) => {
      setIsCreating(true);
      try {
        const thread = await threadService.createThread(input);
        if (!isMounted.current) return thread;
        setThreads((prev) => sortByCreatedAt([...prev.filter((item) => item.id !== thread.id), thread]));
        setActiveThreadId(thread.id);
        return thread;
      } catch (error) {
        console.error("Failed to create thread", error);
        throw error;
      } finally {
        if (isMounted.current) {
          setIsCreating(false);
        }
      }
    }, []);

  const deleteThread = useCallback(async (threadId: string) => {
    if (!threadId) return;
    setDeletingThreadId(threadId);
    try {
      await threadService.deleteThread(threadId);
      if (!isMounted.current) return;
      let nextThreads: Thread[] = [];
      setThreads((prev) => {
        nextThreads = sortByCreatedAt(prev.filter((thread) => thread.id !== threadId));
        return nextThreads;
      });
      setActiveThreadId((current) =>
        current === threadId ? nextThreads[0]?.id ?? null : current
      );
    } catch (error) {
      console.error("Failed to delete thread", error);
      throw error;
    } finally {
      if (isMounted.current) {
        setDeletingThreadId(null);
      }
    }
  }, []);

  const renameThread = useCallback(async (threadId: string, title: string) => {
    const id = threadId.trim();
    const nextTitle = title.trim();
    if (!id || !nextTitle) return;

    setRenamingThreadId(id);
    try {
      const updated = await threadService.renameThread(id, nextTitle);
      if (!updated || !isMounted.current) return;
      setThreads((prev) =>
        sortByCreatedAt(prev.map((thread) => (thread.id === updated.id ? updated : thread)))
      );
    } catch (error) {
      console.error("Failed to rename thread", error);
      throw error;
    } finally {
      if (isMounted.current) {
        setRenamingThreadId((current) => (current === id ? null : current));
      }
    }
  }, []);

  const updateThreadMessages = useCallback(
    async (threadId: string, messages: GroupMessage[]) => {
      if (!threadId) return;
      try {
        const updated = await threadService.saveThreadMessages(threadId, messages);
        if (!updated || !isMounted.current) return;
        setThreads((prev) =>
          sortByCreatedAt(prev.map((thread) => (thread.id === updated.id ? updated : thread)))
        );
      } catch (error) {
        console.error("Failed to update thread messages", error);
      }
    },
    []
  );

  const updateThreadStatus = useCallback(
    async (threadId: string, status: ThreadStatus) => {
      if (!threadId) return;
      try {
        const updated = await threadService.updateThreadStatus(threadId, status);
        if (!updated || !isMounted.current) return;
        setThreads((prev) =>
          sortByCreatedAt(prev.map((thread) => (thread.id === updated.id ? updated : thread)))
        );
      } catch (error) {
        console.error("Failed to update thread status", error);
      }
    },
    []
  );

  const updateThreadOutcomeNote = useCallback(
    async (threadId: string, outcomeNote: string) => {
      if (!threadId) return;
      try {
        const updated = await threadService.updateThreadOutcomeNote(threadId, outcomeNote);
        if (!updated || !isMounted.current) return;
        setThreads((prev) =>
          sortByCreatedAt(prev.map((thread) => (thread.id === updated.id ? updated : thread)))
        );
      } catch (error) {
        console.error("Failed to update thread outcome note", error);
      }
    },
    []
  );

  const updateMessageThreadStatus = useCallback(
    async (threadId: string, messageId: string, status: ThreadStatus) => {
      if (!threadId || !messageId) return;
      try {
        const updated = await threadService.updateMessageThreadStatus(threadId, messageId, status);
        if (!updated || !isMounted.current) return;
        setThreads((prev) =>
          sortByCreatedAt(prev.map((thread) => (thread.id === updated.id ? updated : thread)))
        );
      } catch (error) {
        console.error("Failed to update message thread status", error);
      }
    },
    []
  );

  const updateMessageOutcomeNote = useCallback(
    async (threadId: string, messageId: string, note: string) => {
      if (!threadId || !messageId) return;
      try {
        const updated = await threadService.updateMessageOutcomeNote(threadId, messageId, note);
        if (!updated || !isMounted.current) return;
        setThreads((prev) =>
          sortByCreatedAt(prev.map((thread) => (thread.id === updated.id ? updated : thread)))
        );
      } catch (error) {
        console.error("Failed to update message outcome note", error);
      }
    },
    []
  );

  const isDeletingActiveThread = activeThreadId !== null && deletingThreadId === activeThreadId;

  return {
    threads,
    activeThreadId,
    selectThread,
    createThread,
    deleteThread,
    isLoading,
    isRestoringActiveThread,
    isCreating,
    deletingThreadId,
    renamingThreadId,
    isDeletingActiveThread,
    updateThreadMessages,
    renameThread,
    updateThreadStatus,
    updateThreadOutcomeNote,
    updateMessageThreadStatus,
    updateMessageOutcomeNote,
  };
}
