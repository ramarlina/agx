import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TerminalSession } from "@/lib/terminal-types";

export interface TerminalTabsState {
  sessions: TerminalSession[];

  createSession: (cwd?: string) => string;
  closeSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  setSessionId: (id: string, sessionId: string) => void;
  updateStatus: (id: string, status: TerminalSession["status"]) => void;
}

function nextTitle(sessions: TerminalSession[]): string {
  const nums = sessions
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
      sessions: [],

      createSession(cwd?: string): string {
        const id = crypto.randomUUID();
        const title = nextTitle(get().sessions);
        const session: TerminalSession = {
          id,
          title,
          cwd,
          createdAt: Date.now(),
          status: "connecting",
        };

        set((state) => ({
          sessions: [...state.sessions, session],
        }));

        return id;
      },

      closeSession(id: string): void {
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== id),
        }));
      },

      renameSession(id: string, title: string): void {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, title } : s,
          ),
        }));
      },

      setSessionId(id: string, sessionId: string): void {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, sessionId } : s,
          ),
        }));
      },

      updateStatus(id: string, status: TerminalSession["status"]): void {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, status } : s,
          ),
        }));
      },
    }),
    { name: "agx-terminal-tabs" },
  ),
);
