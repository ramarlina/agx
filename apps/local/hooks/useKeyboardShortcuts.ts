"use client";

import { useEffect, useCallback } from "react";

export interface KeyboardShortcut {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  action: () => void;
  description?: string;
}

/**
 * Hook for registering global keyboard shortcuts.
 * Handles platform differences (Cmd on Mac, Ctrl on Windows/Linux).
 *
 * @example
 * useKeyboardShortcuts([
 *   { key: 'n', metaKey: true, action: () => createNewThread(), description: 'New thread' },
 *   { key: 'k', metaKey: true, action: () => openSearch(), description: 'Search' },
 * ]);
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        // Allow Escape to pass through
        if (event.key !== "Escape") {
          return;
        }
      }

      const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
      const cmdKey = isMac ? event.metaKey : event.ctrlKey;

      for (const shortcut of shortcuts) {
        const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();
        const metaMatch = shortcut.metaKey ? cmdKey : true;
        const ctrlMatch = shortcut.ctrlKey ? event.ctrlKey : true;
        const shiftMatch = shortcut.shiftKey ? event.shiftKey : true;
        const altMatch = shortcut.altKey ? event.altKey : true;

        // If metaKey is specified, we don't require ctrlKey (and vice versa on non-Mac)
        const shouldMatchCtrl = shortcut.ctrlKey && !shortcut.metaKey;
        const ctrlOk = shouldMatchCtrl ? event.ctrlKey : true;

        if (keyMatch && metaMatch && ctrlOk && shiftMatch && altMatch) {
          // For meta shortcuts, ensure we're not just pressing the key without modifier
          if (shortcut.metaKey && !cmdKey) continue;
          if (shortcut.ctrlKey && !event.ctrlKey) continue;

          event.preventDefault();
          shortcut.action();
          return;
        }
      }
    },
    [shortcuts]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);
}

/**
 * Common keyboard shortcuts for the app.
 * Use these constants for consistency across the app.
 */
export const SHORTCUTS = {
  NEW_THREAD: { key: "n", metaKey: true, description: "New thread" },
  SEARCH: { key: "k", metaKey: true, description: "Search" },
  CLOSE: { key: "w", metaKey: true, description: "Close" },
  ESCAPE: { key: "Escape", description: "Escape / Cancel" },
  SIDEBAR_TOGGLE: { key: "b", metaKey: true, description: "Toggle sidebar" },
  LOG_PANEL_TOGGLE: { key: "l", metaKey: true, description: "Toggle logs" },
  REFRESH: { key: "r", metaKey: true, description: "Refresh" },
} as const;

/**
 * Hook for using predefined shortcuts with custom actions.
 *
 * @example
 * useAppShortcuts({
 *   newThread: () => createNewThread(),
 *   search: () => openSearch(),
 *   escape: () => closeModal(),
 * });
 */
export function useAppShortcuts(actions: {
  newThread?: () => void;
  search?: () => void;
  close?: () => void;
  escape?: () => void;
  sidebarToggle?: () => void;
  logPanelToggle?: () => void;
}) {
  const shortcuts: KeyboardShortcut[] = [];

  if (actions.newThread) {
    shortcuts.push({ ...SHORTCUTS.NEW_THREAD, action: actions.newThread });
  }
  if (actions.search) {
    shortcuts.push({ ...SHORTCUTS.SEARCH, action: actions.search });
  }
  if (actions.close) {
    shortcuts.push({ ...SHORTCUTS.CLOSE, action: actions.close });
  }
  if (actions.escape) {
    shortcuts.push({ ...SHORTCUTS.ESCAPE, action: actions.escape });
  }
  if (actions.sidebarToggle) {
    shortcuts.push({ ...SHORTCUTS.SIDEBAR_TOGGLE, action: actions.sidebarToggle });
  }
  if (actions.logPanelToggle) {
    shortcuts.push({ ...SHORTCUTS.LOG_PANEL_TOGGLE, action: actions.logPanelToggle });
  }

  useKeyboardShortcuts(shortcuts);
}