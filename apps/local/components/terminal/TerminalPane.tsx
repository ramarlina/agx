"use client";

import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { TerminalStatus } from "@/lib/terminal-types";
import "@xterm/xterm/css/xterm.css";

interface TerminalPaneProps {
  sessionId?: string;
  tabId: string;
  onTitleChange?: (title: string) => void;
  onSessionReady?: (sessionId: string) => void;
  onStatusChange?: (status: TerminalStatus) => void;
}

export default function TerminalPane({
  tabId,
  onTitleChange,
  onSessionReady,
  onStatusChange,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const connectedRef = useRef(false);
  const onTitleChangeRef = useRef(onTitleChange);
  const onSessionReadyRef = useRef(onSessionReady);
  const onStatusChangeRef = useRef(onStatusChange);
  onTitleChangeRef.current = onTitleChange;
  onSessionReadyRef.current = onSessionReady;
  onStatusChangeRef.current = onStatusChange;

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
    let disposed = false;
    let reconnectTimer: number | null = null;
    let reconnectAttempts = 0;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: "#1e1e1e",
        foreground: "#cdd6f4",
        cursor: "#f5e0dc",
        selectionBackground: "#585b7066",
        selectionForeground: "#cdd6f4",
        black: "#45475a",
        red: "#f38ba8",
        green: "#a6e3a1",
        yellow: "#f9e2af",
        blue: "#89b4fa",
        magenta: "#f5c2e7",
        cyan: "#94e2d5",
        white: "#bac2de",
        brightBlack: "#585b70",
        brightRed: "#f38ba8",
        brightGreen: "#a6e3a1",
        brightYellow: "#f9e2af",
        brightBlue: "#89b4fa",
        brightMagenta: "#f5c2e7",
        brightCyan: "#94e2d5",
        brightWhite: "#a6adc8",
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

    const setStatus = (status: TerminalStatus) => {
      onStatusChangeRef.current?.(status);
    };

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      setStatus("connecting");
      const delay = Math.min(500 * 2 ** reconnectAttempts, 5_000);
      reconnectAttempts += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
      }, delay);
    };

    const connectWebSocket = () => {
      if (disposed) return;
      let sessionReady = false;
      let reconnectSuppressed = false;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }

        connectedRef.current = true;
        setStatus("connecting");
        ws.send(
          JSON.stringify({
            type: "create",
            id: tabId,
          }),
        );
      };

      ws.onmessage = (event) => {
        if (disposed) return;

        let msg: { type: string; [key: string]: unknown };
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case "ready":
            sessionReady = true;
            reconnectAttempts = 0;
            setStatus("active");
            onSessionReadyRef.current?.(msg.id as string);
            requestAnimationFrame(() => {
              if (disposed) return;

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
            sessionReady = false;
            reconnectSuppressed = true;
            setStatus("exited");
            terminal.writeln(
              `\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m`,
            );
            ws.close();
            break;
          case "error":
            reconnectSuppressed = true;
            setStatus("error");
            terminal.writeln(
              `\r\n\x1b[31m[Terminal failed to start: ${String(msg.message)}]\x1b[0m`,
            );
            ws.close();
            break;
        }
      };

      ws.onerror = () => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      ws.onclose = () => {
        const wasCurrentSocket = wsRef.current === ws;
        const wasConnected = connectedRef.current;
        connectedRef.current = false;
        if (wasCurrentSocket) {
          wsRef.current = null;
        }

        if (disposed) {
          return;
        }

        if (reconnectSuppressed) {
          return;
        }

        if (wasConnected || sessionReady) {
          terminal.writeln("\r\n\x1b[90m[Disconnected, reconnecting...]\x1b[0m");
        }

        scheduleReconnect();
      };
    };

    // Defer connection so React Strict Mode's probe mount can clean up
    // without creating a socket that gets closed while still connecting.
    setStatus("connecting");
    const connectTimer = window.setTimeout(connectWebSocket, 0);

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
      disposed = true;
      window.clearTimeout(connectTimer);
      clearReconnectTimer();
      observer.disconnect();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.close();
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      connectedRef.current = false;
    };
  }, [tabId, sendMessage]);

  // Focus terminal on mount
  useEffect(() => {
    terminalRef.current?.focus();
  }, []);

  return (
    <div className="h-full w-full min-h-0 px-2 pb-2 pt-1.5 md:px-3 md:pb-3 md:pt-2">
      <div
        ref={containerRef}
        className="h-full w-full min-h-0 overflow-hidden rounded-xl bg-[#1b1b1d]"
      />
    </div>
  );
}
