"use client";

import { useEffect } from "react";
import { useTerminalTabsStore } from "@/state/terminalTabs";
import { useUrlSelection } from "@/hooks/useUrlSelection";
import TerminalSessionList from "./TerminalSessionList";
import TerminalPane from "./TerminalPane";
import { Terminal } from "lucide-react";

export default function ProjectTerminal() {
  const sessions = useTerminalTabsStore((s) => s.sessions);
  const createSession = useTerminalTabsStore((s) => s.createSession);
  const closeSession = useTerminalTabsStore((s) => s.closeSession);
  const renameSession = useTerminalTabsStore((s) => s.renameSession);
  const setSessionId = useTerminalTabsStore((s) => s.setSessionId);

  const { getSelection, replaceSelection } = useUrlSelection();
  const selectedId = getSelection("session");

  // Auto-create first session if none exist
  useEffect(() => {
    if (sessions.length === 0) {
      const id = createSession();
      replaceSelection({ session: id });
    }
  }, [sessions.length, createSession, replaceSelection]);

  // Auto-select first session if none selected but sessions exist
  useEffect(() => {
    if (!selectedId && sessions.length > 0) {
      replaceSelection({ session: sessions[0].id });
    }
  }, [selectedId, sessions, replaceSelection]);

  // If selected session was closed, clear selection
  useEffect(() => {
    if (selectedId && sessions.length > 0 && !sessions.find((s) => s.id === selectedId)) {
      replaceSelection({ session: sessions[0].id });
    }
  }, [selectedId, sessions, replaceSelection]);

  const selectedSession = sessions.find((s) => s.id === selectedId);

  function handleCreate() {
    const id = createSession();
    replaceSelection({ session: id });
  }

  function handleClose(id: string) {
    closeSession(id);
  }

  function handleSelect(id: string) {
    replaceSelection({ session: id });
  }

  return (
    <div className="flex h-full bg-[var(--background)]">
      {/* Left panel — session list */}
      <div className="flex w-[320px] shrink-0 flex-col border-r border-[var(--card-border)] overflow-hidden">
        <TerminalSessionList
          sessions={sessions}
          selectedId={selectedId}
          onSelect={handleSelect}
          onCreate={handleCreate}
          onClose={handleClose}
          onRename={renameSession}
        />
      </div>

      {/* Right panel — terminal output */}
      <div className="flex-1 min-w-0 min-h-0 relative">
        {selectedSession ? (
          <TerminalPane
            key={selectedSession.id}
            tabId={selectedSession.id}
            onTitleChange={(title) => renameSession(selectedSession.id, title)}
            onSessionReady={(sid) => setSessionId(selectedSession.id, sid)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[var(--muted-foreground)] gap-3">
            <Terminal size={32} className="opacity-30" />
            <p className="text-sm">Select a session or create a new one</p>
          </div>
        )}
      </div>
    </div>
  );
}
