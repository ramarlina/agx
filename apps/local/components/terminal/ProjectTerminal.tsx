"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useInputCapabilities } from "@/hooks/useInputCapabilities";
import { useTerminalTabsStore } from "@/state/terminalTabs";
import { useUrlSelection } from "@/hooks/useUrlSelection";
import TerminalSessionList from "./TerminalSessionList";
import TerminalPane from "./TerminalPane";
import type { TerminalPaneHandle } from "./TerminalPane";
import {
  type TerminalInstance,
  type TerminalStatus,
} from "@/lib/terminal-types";
import { Pencil, Plus, Terminal, X } from "lucide-react";

const GRID_MIN_TERMINAL_WIDTH_PX = 480;

const DEFAULT_PROJECT_KEY = "__global__";

type EditingTerminal = {
  sessionId: string;
  terminalId: string;
};

export default function ProjectTerminal() {
  const params = useParams<{ slug?: string }>();
  const projectId = params?.slug ?? DEFAULT_PROJECT_KEY;

  const { isTouchLayout } = useInputCapabilities();
  const sessions = useTerminalTabsStore((s) => s.getProjectSessions(projectId));
  const createSession = useTerminalTabsStore((s) => s.createSession);
  const closeSession = useTerminalTabsStore((s) => s.closeSession);
  const renameSession = useTerminalTabsStore((s) => s.renameSession);
  const addTerminal = useTerminalTabsStore((s) => s.addTerminal);
  const closeTerminal = useTerminalTabsStore((s) => s.closeTerminal);
  const renameTerminal = useTerminalTabsStore((s) => s.renameTerminal);
  const setTerminalSessionId = useTerminalTabsStore((s) => s.setTerminalSessionId);
  const updateTerminalStatus = useTerminalTabsStore((s) => s.updateTerminalStatus);

  const { getSelection, replaceSelection } = useUrlSelection();
  const searchParams = useSearchParams();
  const initCmd = searchParams.get("cmd");
  const initCmdSentRef = useRef(false);
  const firstTerminalPaneRef = useRef<TerminalPaneHandle>(null);
  const selectedId = getSelection("session");
  const gridRef = useRef<HTMLDivElement>(null);
  const [editingTerminal, setEditingTerminal] = useState<EditingTerminal | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [touchSessionListOpen, setTouchSessionListOpen] = useState(false);
  const [touchActiveTerminalId, setTouchActiveTerminalId] = useState<string | null>(null);

  // Auto-create first session if none exist
  useEffect(() => {
    if (sessions.length === 0) {
      const id = createSession(projectId);
      replaceSelection({ session: id });
    }
  }, [sessions.length, createSession, replaceSelection, projectId]);

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

  // Clear ?cmd param from URL immediately on mount so refresh won't re-run
  useEffect(() => {
    if (!initCmd) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("cmd");
    window.history.replaceState({}, "", url.toString());
  }, [initCmd]);

  const selectedSession = sessions.find((s) => s.id === selectedId);

  useEffect(() => {
    if (!isTouchLayout) {
      return;
    }

    const nextTerminalId = selectedSession?.terminals[0]?.id ?? null;
    setTouchActiveTerminalId((current) => {
      if (!selectedSession) {
        return null;
      }
      if (current && selectedSession.terminals.some((terminal) => terminal.id === current)) {
        return current;
      }
      return nextTerminalId;
    });
  }, [isTouchLayout, selectedSession]);

  function handleCreate() {
    const id = createSession(projectId);
    replaceSelection({ session: id });
    setTouchSessionListOpen(false);
  }

  function handleClose(id: string) {
    const session = sessions.find((item) => item.id === id);
    session?.terminals.forEach((terminal) => {
      void fetch(
        `/api/terminal/sessions/${encodeURIComponent(terminal.sessionId || terminal.id)}`,
        {
          method: "DELETE",
        },
      ).catch(() => {
        // Best-effort cleanup. The session is still removed from the UI.
      });
    });
    closeSession(projectId, id);
  }

  function handleAddTerminal() {
    if (!selectedSession) return;
    addTerminal(projectId, selectedSession.id);
  }

  function handleCloseTerminal(sessionId: string, terminalId: string) {
    const terminal = sessions
      .find((session) => session.id === sessionId)
      ?.terminals.find((item) => item.id === terminalId);

    void fetch(
      `/api/terminal/sessions/${encodeURIComponent(terminal?.sessionId || terminalId)}`,
      {
        method: "DELETE",
      },
    ).catch(() => {
      // Best-effort cleanup. The terminal is still removed from the UI.
    });
    closeTerminal(projectId, sessionId, terminalId);
  }

  function handleStartRenameTerminal(sessionId: string, terminal: TerminalInstance) {
    setEditingTerminal({ sessionId, terminalId: terminal.id });
    setEditingTitle(terminal.title);
  }

  function handleCommitRenameTerminal() {
    if (!editingTerminal) return;
    const nextTitle = editingTitle.trim();
    if (nextTitle) {
      renameTerminal(projectId, editingTerminal.sessionId, editingTerminal.terminalId, nextTitle);
    }
    setEditingTerminal(null);
    setEditingTitle("");
  }

  function handleSelect(id: string) {
    replaceSelection({ session: id });
    setTouchSessionListOpen(false);
  }

  function handleRenameSession(id: string, title: string) {
    renameSession(projectId, id, title);
  }

  function terminalStatusDotClass(status: TerminalStatus): string {
    if (status === "active") return "bg-emerald-400";
    if (status === "connecting") return "bg-amber-400";
    if (status === "error") return "bg-rose-500";
    return "bg-zinc-500";
  }

  function renderTerminalCard(
    sessionId: string,
    terminal: TerminalInstance,
    isSingle: boolean,
    paneRef?: React.RefObject<TerminalPaneHandle | null>,
  ) {
    const isEditing =
      editingTerminal?.sessionId === sessionId &&
      editingTerminal.terminalId === terminal.id;

    return (
      <div
        key={terminal.id}
        className={`relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--app-shell-border)] bg-[var(--app-shell-pane)] ${
          isSingle ? "h-full" : "min-h-[320px]"
        }`}
      >
        <div className="flex items-center justify-between border-b border-[var(--app-shell-border)] px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`inline-block size-2 shrink-0 rounded-full ${terminalStatusDotClass(terminal.status)}`}
            />
            <div className="min-w-0">
              {isEditing ? (
                <input
                  value={editingTitle}
                  onChange={(event) => setEditingTitle(event.target.value)}
                  onBlur={handleCommitRenameTerminal}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleCommitRenameTerminal();
                    if (event.key === "Escape") {
                      setEditingTerminal(null);
                      setEditingTitle("");
                    }
                  }}
                  className="w-full rounded border border-[var(--app-shell-border)] bg-transparent px-1 text-sm font-medium text-[var(--foreground)] outline-none"
                  autoFocus
                />
              ) : (
                <div
                  className="truncate text-sm font-medium text-[var(--foreground)] cursor-text"
                  onDoubleClick={() => handleStartRenameTerminal(sessionId, terminal)}
                >
                  {terminal.title}
                </div>
              )}
              <div className="truncate text-xs text-[var(--muted-foreground)]">
                {terminal.cwd || "Default shell"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleStartRenameTerminal(sessionId, terminal)}
              className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]/20 hover:text-[var(--foreground)]"
              aria-label={`Rename ${terminal.title}`}
            >
              <Pencil size={13} />
            </button>

            {!isSingle ? (
              <button
                type="button"
                onClick={() => handleCloseTerminal(sessionId, terminal.id)}
                className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]/20 hover:text-[var(--foreground)]"
                aria-label={`Close ${terminal.title}`}
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <TerminalPane
            ref={paneRef}
            key={terminal.id}
            tabId={terminal.id}
            onSessionReady={(backendSessionId) => {
              setTerminalSessionId(projectId, sessionId, terminal.id, backendSessionId);
              if (paneRef && initCmd && !initCmdSentRef.current) {
                initCmdSentRef.current = true;
                setTimeout(() => {
                  paneRef.current?.sendCommand(initCmd);
                }, 300);
              }
            }}
            onStatusChange={(status) =>
              updateTerminalStatus(projectId, sessionId, terminal.id, status)
            }
          />
        </div>

      </div>
    );
  }

  return (
    <div className="flex h-full bg-[var(--background)]">
      {isTouchLayout ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {touchSessionListOpen ? (
            <>
              <button
                type="button"
                className="absolute inset-0 z-20 bg-black/40"
                onClick={() => setTouchSessionListOpen(false)}
                aria-label="Close terminal sessions"
              />
              <div className="absolute inset-y-0 left-0 z-30 w-[min(360px,88vw)] overflow-hidden border-r border-[var(--card-border)] bg-[var(--background)] shadow-2xl">
                <TerminalSessionList
                  sessions={sessions}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                  onCreate={handleCreate}
                  onClose={handleClose}
                  onRename={handleRenameSession}
                />
              </div>
            </>
          ) : null}

          <div className="flex items-center justify-between border-b border-[var(--app-shell-border)] px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[var(--foreground)]">
                {selectedSession?.title ?? "Terminal"}
              </div>
              <div className="text-xs text-[var(--muted-foreground)]">
                {selectedSession
                  ? `${selectedSession.terminals.length} terminal${selectedSession.terminals.length === 1 ? "" : "s"} in this session`
                  : "Select a session or create a new one"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTouchSessionListOpen(true)}
                className="inline-flex items-center gap-2 rounded-md border border-[var(--app-shell-border)] bg-[var(--app-shell-surface)] px-3 py-1.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/15"
              >
                <Terminal size={14} />
                Sessions
              </button>
              {selectedSession ? (
                <button
                  type="button"
                  onClick={handleAddTerminal}
                  className="inline-flex items-center gap-2 rounded-md border border-[var(--app-shell-border)] bg-[var(--app-shell-surface)] px-3 py-1.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/15"
                >
                  <Plus size={14} />
                  Add terminal
                </button>
              ) : null}
            </div>
          </div>

          {selectedSession ? (
            <>
              {selectedSession.terminals.length > 1 ? (
                <div className="flex gap-2 overflow-x-auto border-b border-[var(--app-shell-border)] px-3 py-2">
                  {selectedSession.terminals.map((terminal) => (
                    <button
                      key={terminal.id}
                      type="button"
                      onClick={() => setTouchActiveTerminalId(terminal.id)}
                      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                        touchActiveTerminalId === terminal.id
                          ? "bg-[var(--card-bg)] text-[var(--foreground)]"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {terminal.title}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="min-h-0 flex-1 p-3">
                {(() => {
                  const terminal =
                    selectedSession.terminals.find((item) => item.id === touchActiveTerminalId) ??
                    selectedSession.terminals[0];
                  if (!terminal) {
                    return (
                      <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">
                        No terminals in this session yet.
                      </div>
                    );
                  }

                  return renderTerminalCard(
                    selectedSession.id,
                    terminal,
                    true,
                    firstTerminalPaneRef,
                  );
                })()}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-[var(--muted-foreground)] gap-3">
              <Terminal size={32} className="opacity-30" />
              <p className="text-sm">Select a session or create a new one</p>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Left panel — session list */}
          <div className="flex w-[320px] shrink-0 flex-col border-r border-[var(--card-border)] overflow-hidden">
            <TerminalSessionList
              sessions={sessions}
              selectedId={selectedId}
              onSelect={handleSelect}
              onCreate={handleCreate}
              onClose={handleClose}
              onRename={handleRenameSession}
            />
          </div>

          {/* Right panel — terminal output */}
          <div className="flex-1 min-w-0 min-h-0 relative">
            {selectedSession ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex items-center justify-between border-b border-[var(--app-shell-border)] px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--foreground)]">
                      {selectedSession.title}
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)]">
                      {selectedSession.terminals.length} terminal
                      {selectedSession.terminals.length === 1 ? "" : "s"} in this session
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddTerminal}
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--app-shell-border)] bg-[var(--app-shell-surface)] px-3 py-1.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/15"
                  >
                    <Plus size={14} />
                    Add terminal
                  </button>
                </div>

                {(() => {
                  const isSingle = selectedSession.terminals.length === 1;

                  return (
                    <div className={`min-h-0 flex-1 p-3 ${isSingle ? "overflow-hidden" : "overflow-auto"}`}>
                      <div
                        ref={gridRef}
                        className="grid gap-3"
                        style={
                          isSingle
                            ? { gridTemplateColumns: "1fr", gridTemplateRows: "minmax(0, 1fr)", height: "100%" }
                            : { gridTemplateColumns: `repeat(auto-fit, minmax(${GRID_MIN_TERMINAL_WIDTH_PX}px, 1fr))` }
                        }
                      >
                        {selectedSession.terminals.map((terminal, idx) =>
                          renderTerminalCard(
                            selectedSession.id,
                            terminal,
                            isSingle,
                            idx === 0 ? firstTerminalPaneRef : undefined,
                          ),
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-[var(--muted-foreground)] gap-3">
                <Terminal size={32} className="opacity-30" />
                <p className="text-sm">Select a session or create a new one</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
