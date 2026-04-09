import { useState, useCallback, useRef } from "react";

const STORAGE_KEY = "agx-composer-history";
const MAX_HISTORY = 100;

/**
 * Shell-style input history for the composer.
 * - ArrowUp/Down navigates through previously sent messages.
 * - While typing, ArrowUp shows the most recent entry that starts with the current text (partial match).
 * - History is persisted in localStorage across sessions.
 */
export function useComposerHistory() {
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Stores the "live" text the user was typing before they started navigating
  const draftRef = useRef("");

  const getHistory = useCallback((): string[] => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }, []);

  const pushEntry = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const history = getHistory();
    // Deduplicate: remove if already exists at top
    const filtered = history.filter((h) => h !== trimmed);
    filtered.unshift(trimmed);
    // Cap size
    if (filtered.length > MAX_HISTORY) filtered.length = MAX_HISTORY;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch {
      // localStorage full — ignore
    }
    setHistoryIndex(-1);
    draftRef.current = "";
  }, [getHistory]);

  /**
   * Handle ArrowUp/ArrowDown in the composer.
   * Returns the text to set in the editor, or null if the event shouldn't be handled.
   *
   * @param direction "up" | "down"
   * @param currentText the current editor text
   * @param cursorAtBoundary true if cursor is at start (up) or end (down) of the editor
   */
  const navigate = useCallback(
    (
      direction: "up" | "down",
      currentText: string,
      cursorAtBoundary: boolean
    ): string | null => {
      if (!cursorAtBoundary) return null;

      const history = getHistory();
      if (history.length === 0) return null;

      if (direction === "up") {
        // Save draft when starting navigation
        if (historyIndex === -1) {
          draftRef.current = currentText;
        }

        // Partial match: find next entry that starts with draft
        const draft = draftRef.current;
        let startFrom = historyIndex + 1;

        if (draft) {
          // Find next matching entry
          for (let i = startFrom; i < history.length; i++) {
            if (history[i].toLowerCase().startsWith(draft.toLowerCase())) {
              setHistoryIndex(i);
              return history[i];
            }
          }
          return null; // No more matches
        }

        // No draft — simple sequential navigation
        const nextIndex = Math.min(historyIndex + 1, history.length - 1);
        if (nextIndex === historyIndex && historyIndex !== -1) return null;
        setHistoryIndex(nextIndex);
        return history[nextIndex];
      }

      // direction === "down"
      if (historyIndex <= 0) {
        // Back to draft
        if (historyIndex === 0) {
          setHistoryIndex(-1);
          return draftRef.current;
        }
        return null; // Already at draft
      }

      const draft = draftRef.current;
      if (draft) {
        // Find previous matching entry (going back toward recent)
        for (let i = historyIndex - 1; i >= 0; i--) {
          if (history[i].toLowerCase().startsWith(draft.toLowerCase())) {
            setHistoryIndex(i);
            return history[i];
          }
        }
        // No more matches, return to draft
        setHistoryIndex(-1);
        return draftRef.current;
      }

      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      return history[nextIndex];
    },
    [getHistory, historyIndex]
  );

  const resetNavigation = useCallback(() => {
    setHistoryIndex(-1);
    draftRef.current = "";
  }, []);

  return { pushEntry, navigate, resetNavigation, historyIndex };
}
