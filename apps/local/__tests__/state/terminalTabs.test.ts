import { useTerminalTabsStore } from "@/state/terminalTabs";

// Reset store between tests
beforeEach(() => {
  useTerminalTabsStore.setState({ sessions: [] });
});

describe("terminalTabs store", () => {
  describe("createSession", () => {
    it("creates a session", () => {
      const id = useTerminalTabsStore.getState().createSession();
      const state = useTerminalTabsStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].id).toBe(id);
      expect(state.sessions[0].title).toBe("Terminal 1");
      expect(state.sessions[0].status).toBe("connecting");
    });

    it("increments title numbers for subsequent sessions", () => {
      const { createSession } = useTerminalTabsStore.getState();
      createSession();
      createSession();
      createSession();

      const titles = useTerminalTabsStore
        .getState()
        .sessions.map((s) => s.title);
      expect(titles).toEqual(["Terminal 1", "Terminal 2", "Terminal 3"]);
    });

    it("passes cwd to the created session", () => {
      const id = useTerminalTabsStore.getState().createSession("/tmp");
      const session = useTerminalTabsStore
        .getState()
        .sessions.find((s) => s.id === id);
      expect(session?.cwd).toBe("/tmp");
    });
  });

  describe("closeSession", () => {
    it("removes the session from the list", () => {
      const { createSession } = useTerminalTabsStore.getState();
      const id = createSession();
      useTerminalTabsStore.getState().closeSession(id);
      expect(useTerminalTabsStore.getState().sessions).toHaveLength(0);
    });

    it("does not affect other sessions when closing one", () => {
      const { createSession } = useTerminalTabsStore.getState();
      const id1 = createSession();
      const id2 = createSession();

      useTerminalTabsStore.getState().closeSession(id1);
      const sessions = useTerminalTabsStore.getState().sessions;
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(id2);
    });
  });

  describe("renameSession", () => {
    it("renames a session", () => {
      const id = useTerminalTabsStore.getState().createSession();
      useTerminalTabsStore.getState().renameSession(id, "My Shell");

      const session = useTerminalTabsStore
        .getState()
        .sessions.find((s) => s.id === id);
      expect(session?.title).toBe("My Shell");
    });
  });

  describe("setSessionId", () => {
    it("assigns a session id to a session", () => {
      const id = useTerminalTabsStore.getState().createSession();
      useTerminalTabsStore.getState().setSessionId(id, "pty-session-abc");

      const session = useTerminalTabsStore
        .getState()
        .sessions.find((s) => s.id === id);
      expect(session?.sessionId).toBe("pty-session-abc");
    });

    it("does not affect other sessions", () => {
      const { createSession } = useTerminalTabsStore.getState();
      const id1 = createSession();
      const id2 = createSession();

      useTerminalTabsStore.getState().setSessionId(id1, "session-1");

      const session2 = useTerminalTabsStore
        .getState()
        .sessions.find((s) => s.id === id2);
      expect(session2?.sessionId).toBeUndefined();
    });
  });

  describe("updateStatus", () => {
    it("updates the status of a session", () => {
      const id = useTerminalTabsStore.getState().createSession();
      useTerminalTabsStore.getState().updateStatus(id, "active");

      const session = useTerminalTabsStore
        .getState()
        .sessions.find((s) => s.id === id);
      expect(session?.status).toBe("active");
    });

    it("can set status to exited", () => {
      const id = useTerminalTabsStore.getState().createSession();
      useTerminalTabsStore.getState().updateStatus(id, "exited");

      const session = useTerminalTabsStore
        .getState()
        .sessions.find((s) => s.id === id);
      expect(session?.status).toBe("exited");
    });

    it("does not affect other sessions", () => {
      const { createSession } = useTerminalTabsStore.getState();
      const id1 = createSession();
      const id2 = createSession();

      useTerminalTabsStore.getState().updateStatus(id1, "active");

      const session2 = useTerminalTabsStore
        .getState()
        .sessions.find((s) => s.id === id2);
      expect(session2?.status).toBe("connecting");
    });
  });
});
