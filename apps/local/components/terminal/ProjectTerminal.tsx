"use client";

import { useEffect } from "react";
import { useTerminalTabsStore } from "@/state/terminalTabs";
import TerminalTabBar from "./TerminalTabBar";
import TerminalPane from "./TerminalPane";

export default function ProjectTerminal() {
  const tabs = useTerminalTabsStore((s) => s.tabs);
  const activeTabId = useTerminalTabsStore((s) => s.activeTabId);
  const createTab = useTerminalTabsStore((s) => s.createTab);
  const closeTab = useTerminalTabsStore((s) => s.closeTab);
  const renameTab = useTerminalTabsStore((s) => s.renameTab);
  const setActiveTab = useTerminalTabsStore((s) => s.setActiveTab);

  // Auto-create first tab if none exist
  useEffect(() => {
    if (tabs.length === 0) {
      createTab();
    }
  }, [tabs.length, createTab]);

  return (
    <div className="flex flex-col h-full bg-[var(--background)]">
      <TerminalTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTab}
        onClose={closeTab}
        onCreate={() => createTab()}
        onRename={renameTab}
      />

      <div className="flex-1 min-h-0 relative">
        {tabs.map((tab) => (
          <TerminalPane
            key={tab.id}
            sessionId={tab.sessionId}
            isActive={tab.id === activeTabId}
            onTitleChange={(title) => renameTab(tab.id, title)}
          />
        ))}
      </div>
    </div>
  );
}
