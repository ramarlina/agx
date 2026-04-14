import { normalizePersistedSessions, useTerminalTabsStore } from "@/state/terminalTabs";

beforeEach(() => {
  useTerminalTabsStore.setState({ sessions: {} });
});

const PROJECT = "test-project";

describe("terminalTabs store", () => {
  describe("createSession", () => {
    it("creates a session with one terminal", () => {
      const id = useTerminalTabsStore.getState().createSession(PROJECT);
      const sessions = useTerminalTabsStore.getState().getProjectSessions(PROJECT);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(id);
      expect(sessions[0].title).toBe("Terminal 1");
      expect(sessions[0].terminals).toHaveLength(1);
      expect(sessions[0].terminals[0]?.title).toBe("Terminal 1");
      expect(sessions[0].terminals[0]?.status).toBe("connecting");
      expect(sessions[0].terminals[0]?.colSpan).toBe(1);
      expect(sessions[0].terminals[0]?.rowSpan).toBe(1);
    });

    it("increments title numbers for subsequent sessions", () => {
      const { createSession } = useTerminalTabsStore.getState();
      createSession(PROJECT);
      createSession(PROJECT);
      createSession(PROJECT);

      expect(
        useTerminalTabsStore.getState().getProjectSessions(PROJECT).map((session) => session.title),
      ).toEqual(["Terminal 1", "Terminal 2", "Terminal 3"]);
    });

    it("passes cwd to the first terminal", () => {
      const id = useTerminalTabsStore.getState().createSession(PROJECT, "/tmp");
      const session = useTerminalTabsStore
        .getState()
        .getProjectSessions(PROJECT)
        .find((item) => item.id === id);

      expect(session?.terminals[0]?.cwd).toBe("/tmp");
    });

    it("scopes sessions to their project", () => {
      const { createSession, getProjectSessions } = useTerminalTabsStore.getState();
      createSession("project-a");
      createSession("project-a");
      createSession("project-b");

      expect(useTerminalTabsStore.getState().getProjectSessions("project-a")).toHaveLength(2);
      expect(useTerminalTabsStore.getState().getProjectSessions("project-b")).toHaveLength(1);
      expect(useTerminalTabsStore.getState().getProjectSessions("project-c")).toHaveLength(0);
    });
  });

  describe("closeSession", () => {
    it("removes the session from the list", () => {
      const { createSession, closeSession } = useTerminalTabsStore.getState();
      const id = createSession(PROJECT);

      closeSession(PROJECT, id);

      expect(useTerminalTabsStore.getState().getProjectSessions(PROJECT)).toHaveLength(0);
    });
  });

  describe("renameSession", () => {
    it("renames a session", () => {
      const { createSession, renameSession } = useTerminalTabsStore.getState();
      const id = createSession(PROJECT);

      renameSession(PROJECT, id, "My Shell");

      expect(
        useTerminalTabsStore
          .getState()
          .getProjectSessions(PROJECT)
          .find((session) => session.id === id)?.title,
      ).toBe("My Shell");
    });
  });

  describe("addTerminal", () => {
    it("adds another terminal to an existing session", () => {
      const { createSession, addTerminal } = useTerminalTabsStore.getState();
      const sessionId = createSession(PROJECT, "/tmp");

      const terminalId = addTerminal(PROJECT, sessionId, "/var/tmp");
      const session = useTerminalTabsStore
        .getState()
        .getProjectSessions(PROJECT)
        .find((item) => item.id === sessionId);

      expect(terminalId).toBeTruthy();
      expect(session?.terminals).toHaveLength(2);
      expect(session?.terminals[1]?.id).toBe(terminalId);
      expect(session?.terminals[1]?.title).toBe("Terminal 2");
      expect(session?.terminals[1]?.cwd).toBe("/var/tmp");
    });

    it("returns null when the session is missing", () => {
      expect(useTerminalTabsStore.getState().addTerminal(PROJECT, "missing")).toBeNull();
    });
  });

  describe("closeTerminal", () => {
    it("removes only the targeted terminal", () => {
      const store = useTerminalTabsStore.getState();
      const sessionId = store.createSession(PROJECT);
      const terminalId = store.addTerminal(PROJECT, sessionId);
      const firstTerminalId = useTerminalTabsStore
        .getState()
        .getProjectSessions(PROJECT)[0]?.terminals[0]?.id;

      expect(terminalId).toBeTruthy();

      useTerminalTabsStore.getState().closeTerminal(PROJECT, sessionId, String(terminalId));

      const session = useTerminalTabsStore
        .getState()
        .getProjectSessions(PROJECT)
        .find((item) => item.id === sessionId);
      expect(session?.terminals).toHaveLength(1);
      expect(session?.terminals[0]?.id).toBe(firstTerminalId);
    });

    it("removes the whole session when its last terminal is closed", () => {
      const store = useTerminalTabsStore.getState();
      const sessionId = store.createSession(PROJECT);
      const terminalId = useTerminalTabsStore
        .getState()
        .getProjectSessions(PROJECT)[0]?.terminals[0]?.id;

      useTerminalTabsStore.getState().closeTerminal(PROJECT, sessionId, String(terminalId));

      expect(useTerminalTabsStore.getState().getProjectSessions(PROJECT)).toHaveLength(0);
    });
  });

  describe("setTerminalSessionId", () => {
    it("assigns the backend session id to the targeted terminal", () => {
      const store = useTerminalTabsStore.getState();
      const sessionId = store.createSession(PROJECT);
      const terminalId = useTerminalTabsStore
        .getState()
        .getProjectSessions(PROJECT)[0]?.terminals[0]?.id;

      useTerminalTabsStore
        .getState()
        .setTerminalSessionId(PROJECT, sessionId, String(terminalId), "pty-session-abc");

      expect(
        useTerminalTabsStore.getState().getProjectSessions(PROJECT)[0]?.terminals[0]?.sessionId,
      ).toBe("pty-session-abc");
    });
  });

  describe("renameTerminal", () => {
    it("renames the targeted terminal only", () => {
      const store = useTerminalTabsStore.getState();
      const sessionId = store.createSession(PROJECT);
      const secondTerminalId = store.addTerminal(PROJECT, sessionId);
      const firstTerminalId = useTerminalTabsStore
        .getState()
        .getProjectSessions(PROJECT)[0]?.terminals[0]?.id;

      useTerminalTabsStore
        .getState()
        .renameTerminal(PROJECT, sessionId, String(secondTerminalId), "Logs");

      const terminals =
        useTerminalTabsStore.getState().getProjectSessions(PROJECT)[0]?.terminals || [];
      expect(terminals.find((terminal) => terminal.id === secondTerminalId)?.title).toBe("Logs");
      expect(terminals.find((terminal) => terminal.id === firstTerminalId)?.title).toBe(
        "Terminal 1",
      );
    });
  });

  describe("updateTerminalLayout", () => {
    it("snaps layout values into the supported span range", () => {
      const store = useTerminalTabsStore.getState();
      const sessionId = store.createSession(PROJECT);
      const terminalId = useTerminalTabsStore
        .getState()
        .getProjectSessions(PROJECT)[0]?.terminals[0]?.id;

      useTerminalTabsStore
        .getState()
        .updateTerminalLayout(PROJECT, sessionId, String(terminalId), {
          colSpan: 5,
          rowSpan: 0,
        });

      const terminal =
        useTerminalTabsStore.getState().getProjectSessions(PROJECT)[0]?.terminals[0];
      expect(terminal?.colSpan).toBe(2);
      expect(terminal?.rowSpan).toBe(1);
    });
  });

  describe("updateTerminalStatus", () => {
    it("updates only the targeted terminal status", () => {
      const store = useTerminalTabsStore.getState();
      const sessionId = store.createSession(PROJECT);
      const secondTerminalId = store.addTerminal(PROJECT, sessionId);
      const firstTerminalId = useTerminalTabsStore
        .getState()
        .getProjectSessions(PROJECT)[0]?.terminals[0]?.id;

      useTerminalTabsStore
        .getState()
        .updateTerminalStatus(PROJECT, sessionId, String(secondTerminalId), "active");

      const terminals =
        useTerminalTabsStore.getState().getProjectSessions(PROJECT)[0]?.terminals || [];
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
