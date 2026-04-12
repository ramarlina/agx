import { normalizePersistedSessions, useTerminalTabsStore } from "@/state/terminalTabs";

beforeEach(() => {
  useTerminalTabsStore.setState({ sessions: [] });
});

describe("terminalTabs store", () => {
  describe("createSession", () => {
    it("creates a session with one terminal", () => {
      const id = useTerminalTabsStore.getState().createSession();
      const state = useTerminalTabsStore.getState();

      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].id).toBe(id);
      expect(state.sessions[0].title).toBe("Terminal 1");
      expect(state.sessions[0].terminals).toHaveLength(1);
      expect(state.sessions[0].terminals[0]?.title).toBe("Terminal 1");
      expect(state.sessions[0].terminals[0]?.status).toBe("connecting");
      expect(state.sessions[0].terminals[0]?.colSpan).toBe(1);
      expect(state.sessions[0].terminals[0]?.rowSpan).toBe(1);
    });

    it("increments title numbers for subsequent sessions", () => {
      const { createSession } = useTerminalTabsStore.getState();
      createSession();
      createSession();
      createSession();

      expect(useTerminalTabsStore.getState().sessions.map((session) => session.title)).toEqual([
        "Terminal 1",
        "Terminal 2",
        "Terminal 3",
      ]);
    });

    it("passes cwd to the first terminal", () => {
      const id = useTerminalTabsStore.getState().createSession("/tmp");
      const session = useTerminalTabsStore
        .getState()
        .sessions.find((item) => item.id === id);

      expect(session?.terminals[0]?.cwd).toBe("/tmp");
    });
  });

  describe("closeSession", () => {
    it("removes the session from the list", () => {
      const { createSession, closeSession } = useTerminalTabsStore.getState();
      const id = createSession();

      closeSession(id);

      expect(useTerminalTabsStore.getState().sessions).toHaveLength(0);
    });
  });

  describe("renameSession", () => {
    it("renames a session", () => {
      const { createSession, renameSession } = useTerminalTabsStore.getState();
      const id = createSession();

      renameSession(id, "My Shell");

      expect(
        useTerminalTabsStore.getState().sessions.find((session) => session.id === id)?.title,
      ).toBe("My Shell");
    });
  });

  describe("addTerminal", () => {
    it("adds another terminal to an existing session", () => {
      const { createSession, addTerminal } = useTerminalTabsStore.getState();
      const sessionId = createSession("/tmp");

      const terminalId = addTerminal(sessionId, "/var/tmp");
      const session = useTerminalTabsStore
        .getState()
        .sessions.find((item) => item.id === sessionId);

      expect(terminalId).toBeTruthy();
      expect(session?.terminals).toHaveLength(2);
      expect(session?.terminals[1]?.id).toBe(terminalId);
      expect(session?.terminals[1]?.title).toBe("Terminal 2");
      expect(session?.terminals[1]?.cwd).toBe("/var/tmp");
    });

    it("returns null when the session is missing", () => {
      expect(useTerminalTabsStore.getState().addTerminal("missing")).toBeNull();
    });
  });

  describe("closeTerminal", () => {
    it("removes only the targeted terminal", () => {
      const store = useTerminalTabsStore.getState();
      const sessionId = store.createSession();
      const terminalId = store.addTerminal(sessionId);
      const firstTerminalId = useTerminalTabsStore.getState().sessions[0]?.terminals[0]?.id;

      expect(terminalId).toBeTruthy();

      useTerminalTabsStore.getState().closeTerminal(sessionId, String(terminalId));

      const session = useTerminalTabsStore
        .getState()
        .sessions.find((item) => item.id === sessionId);
      expect(session?.terminals).toHaveLength(1);
      expect(session?.terminals[0]?.id).toBe(firstTerminalId);
    });

    it("removes the whole session when its last terminal is closed", () => {
      const store = useTerminalTabsStore.getState();
      const sessionId = store.createSession();
      const terminalId = useTerminalTabsStore.getState().sessions[0]?.terminals[0]?.id;

      useTerminalTabsStore.getState().closeTerminal(sessionId, String(terminalId));

      expect(useTerminalTabsStore.getState().sessions).toHaveLength(0);
    });
  });

  describe("setTerminalSessionId", () => {
    it("assigns the backend session id to the targeted terminal", () => {
      const store = useTerminalTabsStore.getState();
      const sessionId = store.createSession();
      const terminalId = useTerminalTabsStore.getState().sessions[0]?.terminals[0]?.id;

      useTerminalTabsStore
        .getState()
        .setTerminalSessionId(sessionId, String(terminalId), "pty-session-abc");

      expect(
        useTerminalTabsStore.getState().sessions[0]?.terminals[0]?.sessionId,
      ).toBe("pty-session-abc");
    });
  });

  describe("renameTerminal", () => {
    it("renames the targeted terminal only", () => {
      const store = useTerminalTabsStore.getState();
      const sessionId = store.createSession();
      const secondTerminalId = store.addTerminal(sessionId);
      const firstTerminalId = useTerminalTabsStore.getState().sessions[0]?.terminals[0]?.id;

      useTerminalTabsStore
        .getState()
        .renameTerminal(sessionId, String(secondTerminalId), "Logs");

      const terminals = useTerminalTabsStore.getState().sessions[0]?.terminals || [];
      expect(terminals.find((terminal) => terminal.id === secondTerminalId)?.title).toBe("Logs");
      expect(terminals.find((terminal) => terminal.id === firstTerminalId)?.title).toBe(
        "Terminal 1",
      );
    });
  });

  describe("updateTerminalLayout", () => {
    it("snaps layout values into the supported span range", () => {
      const store = useTerminalTabsStore.getState();
      const sessionId = store.createSession();
      const terminalId = useTerminalTabsStore.getState().sessions[0]?.terminals[0]?.id;

      useTerminalTabsStore
        .getState()
        .updateTerminalLayout(sessionId, String(terminalId), {
          colSpan: 5,
          rowSpan: 0,
        });

      const terminal = useTerminalTabsStore.getState().sessions[0]?.terminals[0];
      expect(terminal?.colSpan).toBe(2);
      expect(terminal?.rowSpan).toBe(1);
    });
  });

  describe("updateTerminalStatus", () => {
    it("updates only the targeted terminal status", () => {
      const store = useTerminalTabsStore.getState();
      const sessionId = store.createSession();
      const secondTerminalId = store.addTerminal(sessionId);
      const firstTerminalId = useTerminalTabsStore.getState().sessions[0]?.terminals[0]?.id;

      useTerminalTabsStore
        .getState()
        .updateTerminalStatus(sessionId, String(secondTerminalId), "active");

      const terminals = useTerminalTabsStore.getState().sessions[0]?.terminals || [];
      expect(terminals.find((terminal) => terminal.id === secondTerminalId)?.status).toBe("active");
      expect(terminals.find((terminal) => terminal.id === firstTerminalId)?.status).toBe(
        "connecting",
      );
    });
  });

  describe("normalizePersistedSessions", () => {
    it("migrates the legacy single-terminal shape", () => {
      const normalized = normalizePersistedSessions([
        {
          id: "session-1",
          title: "Terminal 1",
          createdAt: 1,
          cwd: "/tmp",
          sessionId: "pty-1",
          status: "active",
          command: "npm run dev",
        },
      ]);

      expect(normalized).toEqual([
        {
          id: "session-1",
          title: "Terminal 1",
          createdAt: 1,
          terminals: [
            {
              id: "session-1",
              title: "Terminal 1",
              cwd: "/tmp",
              createdAt: 1,
              sessionId: undefined,
              status: "connecting",
              command: "npm run dev",
              colSpan: 1,
              rowSpan: 1,
            },
          ],
        },
      ]);
    });

    it("resets runtime fields on nested terminal sessions", () => {
      const normalized = normalizePersistedSessions([
        {
          id: "session-2",
          title: "Terminal 2",
          createdAt: 2,
          terminals: [
            {
              id: "term-1",
              createdAt: 2,
              sessionId: "pty-1",
              status: "active",
            },
            {
              id: "term-2",
              createdAt: 3,
              sessionId: "pty-2",
              status: "error",
            },
          ],
        },
      ]);

      expect(normalized).toEqual([
        {
          id: "session-2",
          title: "Terminal 2",
          createdAt: 2,
          terminals: [
            {
              id: "term-1",
              title: "Terminal 1",
              createdAt: 2,
              sessionId: undefined,
              status: "connecting",
              cwd: undefined,
              command: undefined,
              colSpan: 1,
              rowSpan: 1,
            },
            {
              id: "term-2",
              title: "Terminal 2",
              createdAt: 3,
              sessionId: undefined,
              status: "connecting",
              cwd: undefined,
              command: undefined,
              colSpan: 1,
              rowSpan: 1,
            },
          ],
        },
      ]);
    });
  });
});
