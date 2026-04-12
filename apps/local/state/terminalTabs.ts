import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  TerminalInstance,
  TerminalSession,
  TerminalStatus,
} from "@/lib/terminal-types";

export interface TerminalTabsState {
  sessions: TerminalSession[];

  createSession: (cwd?: string) => string;
  closeSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  addTerminal: (sessionId: string, cwd?: string) => string | null;
  closeTerminal: (sessionId: string, terminalId: string) => void;
  renameTerminal: (
    sessionId: string,
    terminalId: string,
    title: string,
  ) => void;
  updateTerminalLayout: (
    sessionId: string,
    terminalId: string,
    layout: { colSpan?: number; rowSpan?: number },
  ) => void;
  setTerminalSessionId: (
    sessionId: string,
    terminalId: string,
    backendSessionId: string,
  ) => void;
  updateTerminalStatus: (
    sessionId: string,
    terminalId: string,
    status: TerminalStatus,
  ) => void;
}

function nextTitle(sessions: TerminalSession[]): string {
  const nums = sessions
    .map((session) => {
      const match = session.title.match(/^Terminal (\d+)$/);
      return match ? Number(match[1]) : 0;
    })
    .filter((n) => n > 0);

  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `Terminal ${next}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nextTerminalTitle(terminals: TerminalInstance[]): string {
  const nums = terminals
    .map((terminal) => {
      const match = terminal.title.match(/^Terminal (\d+)$/);
      return match ? Number(match[1]) : 0;
    })
    .filter((n) => n > 0);

  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `Terminal ${next}`;
}

function createTerminal(
  terminals: TerminalInstance[],
  cwd?: string,
  id = crypto.randomUUID(),
): TerminalInstance {
  return {
    id,
    title: nextTerminalTitle(terminals),
    cwd,
    createdAt: Date.now(),
    status: "connecting",
    colSpan: 1,
    rowSpan: 1,
  };
}

function normalizeTerminal(
  terminal: Partial<TerminalInstance> | undefined,
  fallbackId: string,
  fallbackCreatedAt: number,
  fallbackCwd?: string,
  fallbackCommand?: string,
): TerminalInstance {
  return {
    id: terminal?.id || fallbackId,
    title:
      typeof terminal?.title === "string" && terminal.title.trim().length > 0
        ? terminal.title
        : nextTerminalTitle([]),
    cwd: terminal?.cwd ?? fallbackCwd,
    createdAt: terminal?.createdAt ?? fallbackCreatedAt,
    sessionId: undefined,
    status: "connecting",
    command: terminal?.command ?? fallbackCommand,
    colSpan: clamp(terminal?.colSpan ?? 1, 1, 2),
    rowSpan: clamp(terminal?.rowSpan ?? 1, 1, 4),
  };
}

export function normalizePersistedSessions(
  sessions: Array<Partial<TerminalSession>> = [],
): TerminalSession[] {
  return sessions.map((session, index) => {
    const createdAt =
      typeof session.createdAt === "number" ? session.createdAt : Date.now() + index;
    const legacyTerminalLike = session as Partial<TerminalInstance> & {
      cwd?: string;
      command?: string;
    };
    const terminals: TerminalInstance[] = [];

    if (Array.isArray(session.terminals) && session.terminals.length > 0) {
      for (const [terminalIndex, terminal] of session.terminals.entries()) {
        const normalizedTerminal = normalizeTerminal(
          terminal,
          `${session.id || crypto.randomUUID()}-terminal-${terminalIndex + 1}`,
          typeof terminal?.createdAt === "number" ? terminal.createdAt : createdAt,
        );

        if (!terminal?.title || terminal.title.trim().length === 0) {
          normalizedTerminal.title = nextTerminalTitle(terminals);
        }

        terminals.push(normalizedTerminal);
      }
    } else {
      const normalizedTerminal = normalizeTerminal(
        legacyTerminalLike,
        String(session.id || crypto.randomUUID()),
        createdAt,
        legacyTerminalLike.cwd,
        legacyTerminalLike.command,
      );

      if (!legacyTerminalLike.title || legacyTerminalLike.title.trim().length === 0) {
        normalizedTerminal.title = nextTerminalTitle(terminals);
      }

      terminals.push(normalizedTerminal);
    }

    return {
      id: String(session.id || crypto.randomUUID()),
      title: typeof session.title === "string" ? session.title : nextTitle([]),
      createdAt,
      terminals,
    };
  });
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
          createdAt: Date.now(),
          terminals: [createTerminal([], cwd)],
        };

        set((state) => ({
          sessions: [...state.sessions, session],
        }));

        return id;
      },

      closeSession(id: string): void {
        set((state) => ({
          sessions: state.sessions.filter((session) => session.id !== id),
        }));
      },

      renameSession(id: string, title: string): void {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === id ? { ...session, title } : session,
          ),
        }));
      },

      addTerminal(sessionId: string, cwd?: string): string | null {
        const terminalId = crypto.randomUUID();
        let added = false;

        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== sessionId) {
              return session;
            }

            added = true;
            return {
              ...session,
              terminals: [
                ...session.terminals,
                createTerminal(session.terminals, cwd, terminalId),
              ],
            };
          }),
        }));

        return added ? terminalId : null;
      },

      closeTerminal(sessionId: string, terminalId: string): void {
        set((state) => ({
          sessions: state.sessions
            .map((session) => {
              if (session.id !== sessionId) {
                return session;
              }

              return {
                ...session,
                terminals: session.terminals.filter(
                  (terminal) => terminal.id !== terminalId,
                ),
              };
            })
            .filter((session) => session.terminals.length > 0),
        }));
      },

      renameTerminal(sessionId: string, terminalId: string, title: string): void {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  terminals: session.terminals.map((terminal) =>
                    terminal.id === terminalId
                      ? { ...terminal, title }
                      : terminal,
                  ),
                }
              : session,
          ),
        }));
      },

      updateTerminalLayout(sessionId: string, terminalId: string, layout): void {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  terminals: session.terminals.map((terminal) =>
                    terminal.id === terminalId
                      ? {
                          ...terminal,
                          colSpan: clamp(
                            layout.colSpan ?? terminal.colSpan,
                            1,
                            2,
                          ),
                          rowSpan: clamp(
                            layout.rowSpan ?? terminal.rowSpan,
                            1,
                            4,
                          ),
                        }
                      : terminal,
                  ),
                }
              : session,
          ),
        }));
      },

      setTerminalSessionId(
        sessionId: string,
        terminalId: string,
        backendSessionId: string,
      ): void {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  terminals: session.terminals.map((terminal) =>
                    terminal.id === terminalId
                      ? { ...terminal, sessionId: backendSessionId }
                      : terminal,
                  ),
                }
              : session,
          ),
        }));
      },

      updateTerminalStatus(
        sessionId: string,
        terminalId: string,
        status: TerminalStatus,
      ): void {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  terminals: session.terminals.map((terminal) =>
                    terminal.id === terminalId
                      ? { ...terminal, status }
                      : terminal,
                  ),
                }
              : session,
          ),
        }));
      },
    }),
    {
      name: "agx-terminal-tabs",
      merge(persistedState, currentState) {
        const persisted =
          (persistedState as Partial<TerminalTabsState> | undefined) ?? {};
        return {
          ...currentState,
          ...persisted,
          sessions: normalizePersistedSessions(
            Array.isArray(persisted.sessions)
              ? (persisted.sessions as Array<Partial<TerminalSession>>)
              : currentState.sessions,
          ),
        };
      },
    },
  ),
);
