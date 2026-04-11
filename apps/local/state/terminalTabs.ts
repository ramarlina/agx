import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TerminalTab } from "@/lib/terminal-types";

export interface TerminalTabsState {
  tabs: TerminalTab[];
  activeTabId: string | null;

  createTab: (cwd?: string) => string;
  closeTab: (id: string) => void;
  renameTab: (id: string, title: string) => void;
  setActiveTab: (id: string) => void;
  setSessionId: (tabId: string, sessionId: string) => void;
}

function nextTitle(tabs: TerminalTab[]): string {
  const nums = tabs
    .map((t) => {
      const match = t.title.match(/^Terminal (\d+)$/);
      return match ? Number(match[1]) : 0;
    })
    .filter((n) => n > 0);

  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `Terminal ${next}`;
}

export const useTerminalTabsStore = create<TerminalTabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,

      createTab(cwd?: string): string {
        const id = crypto.randomUUID();
        const title = nextTitle(get().tabs);
        const tab: TerminalTab = { id, title, cwd, createdAt: Date.now() };

        set((state) => ({
          tabs: [...state.tabs, tab],
          activeTabId: id,
        }));

        return id;
      },

      closeTab(id: string): void {
        set((state) => {
          const idx = state.tabs.findIndex((t) => t.id === id);
          if (idx === -1) return state;

          const nextTabs = state.tabs.filter((t) => t.id !== id);
          let nextActive = state.activeTabId;

          if (state.activeTabId === id) {
            if (nextTabs.length === 0) {
              nextActive = null;
            } else if (idx < nextTabs.length) {
              nextActive = nextTabs[idx].id;
            } else {
              nextActive = nextTabs[nextTabs.length - 1].id;
            }
          }

          return { tabs: nextTabs, activeTabId: nextActive };
        });
      },

      renameTab(id: string, title: string): void {
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
        }));
      },

      setActiveTab(id: string): void {
        set({ activeTabId: id });
      },

      setSessionId(tabId: string, sessionId: string): void {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, sessionId } : t,
          ),
        }));
      },
    }),
    { name: "agx-terminal-tabs" },
  ),
);
