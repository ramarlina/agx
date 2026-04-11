"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalPaneProps {
  sessionId?: string;
  isActive: boolean;
  onTitleChange?: (title: string) => void;
}

export default function TerminalPane({
  sessionId,
  isActive,
  onTitleChange,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
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

    // Initial fit after a frame so the container has dimensions
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // Container may not be visible yet
      }
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Welcome message
    terminal.writeln("Welcome to AGX Terminal");
    terminal.writeln("");
    terminal.write("$ ");

    // Local echo for now (PTY will replace this)
    let currentLine = "";
    terminal.onKey(({ key, domEvent }) => {
      const code = domEvent.keyCode;
      if (code === 13) {
        // Enter
        terminal.writeln("");
        if (currentLine.trim()) {
          terminal.writeln(`\x1b[90m[no PTY] ${currentLine}\x1b[0m`);
        }
        currentLine = "";
        terminal.write("$ ");
      } else if (code === 8) {
        // Backspace
        if (currentLine.length > 0) {
          currentLine = currentLine.slice(0, -1);
          terminal.write("\b \b");
        }
      } else if (key.length === 1 && !domEvent.ctrlKey && !domEvent.altKey && !domEvent.metaKey) {
        currentLine += key;
        terminal.write(key);
      }
    });

    // ResizeObserver to auto-fit
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit errors when container is hidden
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Re-fit when becoming active
  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      requestAnimationFrame(() => {
        try {
          fitAddonRef.current?.fit();
        } catch {
          // Ignore
        }
      });
    }
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      style={{ display: isActive ? "block" : "none" }}
      className="h-full w-full"
    />
  );
}
