"use client";

import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalPaneProps {
  sessionId?: string;
  tabId: string;
  onTitleChange?: (title: string) => void;
  onSessionReady?: (sessionId: string) => void;
}

export default function TerminalPane({
  tabId,
  onTitleChange,
  onSessionReady,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const connectedRef = useRef(false);

  const sendMessage = useCallback(
    (msg: Record<string, unknown>) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: "#0f1117",
        foreground: "#d4d4d8",
        cursor: "#a1a1aa",
        selectionBackground: "#3f3f4680",
        black: "#18181b",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#d4d4d8",
        brightBlack: "#52525b",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#fafafa",
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // Container may not be visible yet
      }
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Connect to PTY WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal`);
    wsRef.current = ws;

    ws.onopen = () => {
      connectedRef.current = true;
      // Request a PTY session
      ws.send(
        JSON.stringify({
          type: "create",
          id: tabId,
        }),
      );
    };

    ws.onmessage = (event) => {
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "ready":
          onSessionReady?.(msg.id as string);
          // Send initial size
          requestAnimationFrame(() => {
            try {
              fitAddon.fit();
              sendMessage({
                type: "resize",
                cols: terminal.cols,
                rows: terminal.rows,
              });
            } catch {
              // ignore
            }
          });
          break;
        case "data":
          terminal.write(msg.data as string);
          break;
        case "exit":
          terminal.writeln(
            `\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m`,
          );
          break;
      }
    };

    ws.onclose = () => {
      connectedRef.current = false;
      terminal.writeln("\r\n\x1b[90m[Disconnected]\x1b[0m");
    };

    // Forward terminal input to PTY
    terminal.onData((data) => {
      sendMessage({ type: "data", data });
    });

    // ResizeObserver to auto-fit and notify PTY
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        if (connectedRef.current) {
          sendMessage({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows,
          });
        }
      } catch {
        // Ignore fit errors when container is hidden
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      ws.close();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
      connectedRef.current = false;
    };
  }, [tabId, sendMessage, onSessionReady, onTitleChange]);

  // Focus terminal on mount
  useEffect(() => {
    terminalRef.current?.focus();
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
    />
  );
}
