import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  TerminalInstance,
  TerminalSession,
  TerminalStatus,
} from "@/lib/terminal-types";

const DEFAULT_PROJECT_KEY = "__global__";

export interface TerminalTabsState {
  sessions: Record<string, TerminalSession[]>;

  getProjectSessions: (projectId: string) => TerminalSession[];
  createSession: (projectId: string, cwd?: string) => string;
  closeSession: (projectId: string, id: string) => void;
  renameSession: (projectId: string, id: string, title: string) => void;
  addTerminal: (projectId: string, sessionId: string, cwd?: string) => string | null;
  closeTerminal: (projectId: string, sessionId: string, terminalId: string) => void;
  renameTerminal: (
    projectId: string,
    sessionId: string,
    terminalId: string,
    title: string,
  ) => void;
  updateTerminalLayout: (
    projectId: string,
    sessionId: string,
    terminalId: string,
    layout: { colSpan?: number; rowSpan?: number },
  ) => void;
  setTerminalSessionId: (
    projectId: string,
    sessionId: string,
    terminalId: string,
    backendSessionId: string,
  ) => void;
  updateTerminalStatus: (
    projectId: string,
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

/**
 * Migrate legacy persisted state where sessions was a flat array
 * to the new project-keyed Record shape.
 */
function migratePersistedSessions(
  raw: unknown,
): Record<string, TerminalSession[]> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    // Already in Record shape — normalize each project's sessions
    const result: Record<string, TerminalSession[]> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      result[key] = normalizePersistedSessions(
        Array.isArray(value) ? (value as Array<Partial<TerminalSession>>) : [],
      );
    }
    return result;
  }

  if (Array.isArray(raw)) {
    // Legacy flat array — migrate to default project key
    return {
      [DEFAULT_PROJECT_KEY]: normalizePersistedSessions(
        raw as Array<Partial<TerminalSession>>,
      ),
    };
  }

  return {};
}

function getProjectSessionsList(
  sessions: Record<string, TerminalSession[]>,
  projectId: string,
): TerminalSession[] {
  return sessions[projectId] ?? [];
}

function updateProjectSessions(
  sessions: Record<string, TerminalSession[]>,
  projectId: string,
  updater: (projectSessions: TerminalSession[]) => TerminalSession[],
): Record<string, TerminalSession[]> {
  const current = sessions[projectId] ?? [];
  const updated = updater(current);
  return { ...sessions, [projectId]: updated };
}

export const useTerminalTabsStore = create<TerminalTabsState>()(
  persist(
    (set, get) => ({
      sessions: {},

      getProjectSessions(projectId: string): TerminalSession[] {
        return getProjectSessionsList(get().sessions, projectId);
      },

      createSession(projectId: string, cwd?: string): string {
        const id = crypto.randomUUID();
        const projectSessions = getProjectSessionsList(get().sessions, projectId);
        const title = nextTitle(projectSessions);
        const session: TerminalSession = {
          id,
          title,
          createdAt: Date.now(),
          terminals: [createTerminal([], cwd)],
        };

        set((state) => ({
          sessions: updateProjectSessions(state.sessions, projectId, (ps) => [
            ...ps,
            session,
          ]),
        }));

        return id;
      },

      closeSession(projectId: string, id: string): void {
        set((state) => ({
          sessions: updateProjectSessions(state.sessions, projectId, (ps) =>
            ps.filter((session) => session.id !== id),
          ),
        }));
      },

      renameSession(projectId: string, id: string, title: string): void {
        set((state) => ({
          sessions: updateProjectSessions(state.sessions, projectId, (ps) =>
            ps.map((session) =>
              session.id === id ? { ...session, title } : session,
            ),
          ),
        }));
      },

      addTerminal(projectId: string, sessionId: string, cwd?: string): string | null {
        const terminalId = crypto.randomUUID();
        let added = false;

        set((state) => ({
          sessions: updateProjectSessions(state.sessions, projectId, (ps) =>
            ps.map((session) => {
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
          ),
        }));

        return added ? terminalId : null;
      },

      closeTerminal(projectId: string, sessionId: string, terminalId: string): void {
        set((state) => ({
          sessions: updateProjectSessions(state.sessions, projectId, (ps) =>
            ps
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
          ),
        }));
      },

      renameTerminal(projectId: string, sessionId: string, terminalId: string, title: string): void {
        set((state) => ({
          sessions: updateProjectSessions(state.sessions, projectId, (ps) =>
            ps.map((session) =>
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
          ),
        }));
      },

      updateTerminalLayout(projectId: string, sessionId: string, terminalId: string, layout): void {
        set((state) => ({
          sessions: updateProjectSessions(state.sessions, projectId, (ps) =>
            ps.map((session) =>
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
          ),
        }));
      },

      setTerminalSessionId(
        projectId: string,
        sessionId: string,
        terminalId: string,
        backendSessionId: string,
      ): void {
        set((state) => ({
          sessions: updateProjectSessions(state.sessions, projectId, (ps) =>
            ps.map((session) =>
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
          ),
        }));
      },

      updateTerminalStatus(
        projectId: string,
        sessionId: string,
        terminalId: string,
        status: TerminalStatus,
      ): void {
        set((state) => ({
          sessions: updateProjectSessions(state.sessions, projectId, (ps) =>
            ps.map((session) =>
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
          sessions: migratePersistedSessions(persisted.sessions),
        };
      },
    },
  ),
);
