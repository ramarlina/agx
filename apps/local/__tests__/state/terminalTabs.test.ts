import { useTerminalTabsStore } from "@/state/terminalTabs";

// Reset store between tests
beforeEach(() => {
  useTerminalTabsStore.setState({ tabs: [], activeTabId: null });
});

describe("terminalTabs store", () => {
  describe("createTab", () => {
    it("creates a tab and sets it active", () => {
      const id = useTerminalTabsStore.getState().createTab();
      const state = useTerminalTabsStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0].id).toBe(id);
      expect(state.tabs[0].title).toBe("Terminal 1");
      expect(state.activeTabId).toBe(id);
    });

    it("increments title numbers for subsequent tabs", () => {
      const { createTab } = useTerminalTabsStore.getState();
      createTab();
      createTab();
      createTab();

      const titles = useTerminalTabsStore.getState().tabs.map((t) => t.title);
      expect(titles).toEqual(["Terminal 1", "Terminal 2", "Terminal 3"]);
    });

    it("passes cwd to the created tab", () => {
      const id = useTerminalTabsStore.getState().createTab("/tmp");
      const tab = useTerminalTabsStore.getState().tabs.find((t) => t.id === id);
      expect(tab?.cwd).toBe("/tmp");
    });

    it("sets the newly created tab as active", () => {
      const { createTab } = useTerminalTabsStore.getState();
      const id1 = createTab();
      expect(useTerminalTabsStore.getState().activeTabId).toBe(id1);
      const id2 = createTab();
      expect(useTerminalTabsStore.getState().activeTabId).toBe(id2);
    });
  });

  describe("closeTab", () => {
    it("removes the tab from the list", () => {
      const { createTab } = useTerminalTabsStore.getState();
      const id = createTab();
      useTerminalTabsStore.getState().closeTab(id);
      expect(useTerminalTabsStore.getState().tabs).toHaveLength(0);
    });

    it("activates the next tab when closing the active tab", () => {
      const { createTab } = useTerminalTabsStore.getState();
      const id1 = createTab();
      const id2 = createTab();
      const id3 = createTab();

      // Activate the middle tab then close it
      useTerminalTabsStore.getState().setActiveTab(id2);
      useTerminalTabsStore.getState().closeTab(id2);

      // The tab that was at the same index (id3) should now be active
      expect(useTerminalTabsStore.getState().activeTabId).toBe(id3);
    });

    it("activates the previous tab when closing the last tab in the list", () => {
      const { createTab } = useTerminalTabsStore.getState();
      const id1 = createTab();
      const id2 = createTab();

      // id2 is active (last created), close it
      useTerminalTabsStore.getState().closeTab(id2);
      expect(useTerminalTabsStore.getState().activeTabId).toBe(id1);
    });

    it("sets activeTabId to null when closing the only tab", () => {
      const id = useTerminalTabsStore.getState().createTab();
      useTerminalTabsStore.getState().closeTab(id);
      expect(useTerminalTabsStore.getState().activeTabId).toBeNull();
    });

    it("does not change active tab when closing a non-active tab", () => {
      const { createTab } = useTerminalTabsStore.getState();
      const id1 = createTab();
      const id2 = createTab();

      // id2 is active, close id1
      useTerminalTabsStore.getState().closeTab(id1);
      expect(useTerminalTabsStore.getState().activeTabId).toBe(id2);
    });
  });

  describe("renameTab", () => {
    it("renames a tab", () => {
      const id = useTerminalTabsStore.getState().createTab();
      useTerminalTabsStore.getState().renameTab(id, "My Shell");

      const tab = useTerminalTabsStore.getState().tabs.find((t) => t.id === id);
      expect(tab?.title).toBe("My Shell");
    });
  });

  describe("setActiveTab", () => {
    it("updates the active tab id", () => {
      const { createTab } = useTerminalTabsStore.getState();
      const id1 = createTab();
      const id2 = createTab();

      useTerminalTabsStore.getState().setActiveTab(id1);
      expect(useTerminalTabsStore.getState().activeTabId).toBe(id1);
    });
  });

  describe("setSessionId", () => {
    it("assigns a session id to a tab", () => {
      const id = useTerminalTabsStore.getState().createTab();
      useTerminalTabsStore.getState().setSessionId(id, "pty-session-abc");

      const tab = useTerminalTabsStore.getState().tabs.find((t) => t.id === id);
      expect(tab?.sessionId).toBe("pty-session-abc");
    });

    it("does not affect other tabs", () => {
      const { createTab } = useTerminalTabsStore.getState();
      const id1 = createTab();
      const id2 = createTab();

      useTerminalTabsStore.getState().setSessionId(id1, "session-1");

      const tab2 = useTerminalTabsStore.getState().tabs.find((t) => t.id === id2);
      expect(tab2?.sessionId).toBeUndefined();
    });
  });
});
