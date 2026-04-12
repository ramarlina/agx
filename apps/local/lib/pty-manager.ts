import fs from "fs";
import path from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as pty from "node-pty";

export type TerminalBackend = "pty" | "compat";

export interface TerminalProcess {
  onData: (listener: (data: string) => void) => void;
  onExit: (listener: (event: { exitCode: number }) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

export interface PtySession {
  id: string;
  process: TerminalProcess;
  createdAt: number;
  outputBuffer: string;
  exitCode?: number;
  listeners: Set<SessionListener>;
  backend: TerminalBackend;
}

const sessions = new Map<string, PtySession>();
const MAX_OUTPUT_BUFFER = 64_000;

interface SessionListener {
  onData?: (data: string) => void;
  onExit?: (event: { exitCode: number }) => void;
}

const defaultShell =
  process.platform === "win32"
    ? "powershell.exe"
    : process.env.SHELL || "/bin/zsh";
let nodePtyHelperPrepared = false;

function appendOutput(buffer: string, chunk: string): string {
  const nextBuffer = buffer + chunk;
  if (nextBuffer.length <= MAX_OUTPUT_BUFFER) {
    return nextBuffer;
  }
  return nextBuffer.slice(-MAX_OUTPUT_BUFFER);
}

function getNodePtySpawnHelperPaths(): string[] {
  if (process.platform === "win32") {
    return [];
  }

  const packageRoot = path.dirname(require.resolve("node-pty/package.json"));
  return [
    path.join(packageRoot, "build", "Release", "spawn-helper"),
    path.join(packageRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
  ];
}

function ensureNodePtySpawnHelperExecutable(): void {
  if (nodePtyHelperPrepared || process.platform === "win32") {
    return;
  }

  nodePtyHelperPrepared = true;

  for (const helperPath of getNodePtySpawnHelperPaths()) {
    if (!fs.existsSync(helperPath)) continue;
    try {
      fs.chmodSync(helperPath, 0o755);
    } catch {
      // Best-effort repair. If it still fails, fallback logic will handle it.
    }
  }
}

function createNodePtyProcess(
  shell: string,
  cwd: string,
  env: Record<string, string>,
): TerminalProcess {
  ensureNodePtySpawnHelperExecutable();

  const proc = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env,
  });

  return {
    onData(listener) {
      proc.onData(listener);
    },
    onExit(listener) {
      proc.onExit(({ exitCode }) => {
        listener({ exitCode });
      });
    },
    write(data) {
      proc.write(data);
    },
    resize(cols, rows) {
      proc.resize(cols, rows);
    },
    kill() {
      proc.kill();
    },
  };
}

function getCompatibilityShellArgs(shell: string): string[] {
  if (process.platform === "win32") {
    if (/powershell/i.test(path.basename(shell))) {
      return ["-NoLogo", "-NoExit"];
    }
    return [];
  }

  const base = path.basename(shell);
  if (base === "zsh") {
    return ["-f", "-i"];
  }
  if (base === "bash") {
    return ["--noprofile", "--norc", "-i"];
  }
  return ["-i"];
}

function createCompatibilityProcess(
  shell: string,
  cwd: string,
  env: Record<string, string>,
): TerminalProcess {
  const compatEnv =
    process.platform === "win32"
      ? env
      : { ...env, TERM: env.TERM || "dumb" };

  const child = spawn(shell, getCompatibilityShellArgs(shell), {
    cwd,
    env: compatEnv as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: { exitCode: number }) => void>();
  const emitData = (chunk: string | Buffer) => {
    const data = chunk.toString();
    for (const listener of dataListeners) {
      listener(data);
    }
  };

  child.stdout.on("data", emitData);
  child.stderr.on("data", emitData);
  child.on("exit", (code: number | null) => {
    for (const listener of exitListeners) {
      listener({ exitCode: code ?? 0 });
    }
  });

  return {
    onData(listener) {
      dataListeners.add(listener);
    },
    onExit(listener) {
      exitListeners.add(listener);
    },
    write(data) {
      child.stdin.write(data);
    },
    resize() {
      // Compatibility backend uses stdio pipes, so terminal size changes
      // cannot be propagated as a real PTY resize.
    },
    kill() {
      child.kill();
    },
  };
}

function createTerminalProcess(
  shell: string,
  cwd: string,
  env: Record<string, string>,
): { backend: TerminalBackend; process: TerminalProcess; startupMessage?: string } {
  try {
    return {
      backend: "pty",
      process: createNodePtyProcess(shell, cwd, env),
    };
  } catch (ptyError) {
    const ptyMessage =
      ptyError instanceof Error ? ptyError.message : "unknown node-pty error";

    try {
      return {
        backend: "compat",
        process: createCompatibilityProcess(shell, cwd, env),
        startupMessage:
          `[AGX terminal compatibility mode: node-pty failed (${ptyMessage}). ` +
          "Resize and job control may be limited.]\r\n",
      };
    } catch (fallbackError) {
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : "unknown compatibility backend error";
      throw new Error(
        `node-pty failed (${ptyMessage}); compatibility backend failed (${fallbackMessage})`,
      );
    }
  }
}

export function createSession(
  id: string,
  cwd?: string,
): PtySession {
  const sessionCwd = cwd || process.env.HOME || "/";
  const sessionEnv = { ...process.env } as Record<string, string>;
  const {
    backend,
    process: terminalProcess,
    startupMessage,
  } = createTerminalProcess(defaultShell, sessionCwd, sessionEnv);

  const session: PtySession = {
    id,
    process: terminalProcess,
    createdAt: Date.now(),
    outputBuffer: startupMessage || "",
    listeners: new Set(),
    backend,
  };

  terminalProcess.onData((data: string) => {
    if (!sessions.has(session.id)) return;
    session.outputBuffer = appendOutput(session.outputBuffer, data);
    for (const listener of session.listeners) {
      listener.onData?.(data);
    }
  });

  terminalProcess.onExit(({ exitCode }) => {
    if (!sessions.has(session.id)) return;
    session.exitCode = exitCode;
    for (const listener of session.listeners) {
      listener.onExit?.({ exitCode });
    }
  });

  sessions.set(id, session);
  return session;
}

export function getSession(id: string): PtySession | undefined {
  return sessions.get(id);
}

export function subscribeToSession(
  id: string,
  listener: SessionListener,
): () => void {
  const session = sessions.get(id);
  if (!session) {
    return () => {};
  }

  session.listeners.add(listener);

  if (session.outputBuffer) {
    listener.onData?.(session.outputBuffer);
  }

  if (typeof session.exitCode === "number") {
    listener.onExit?.({ exitCode: session.exitCode });
  }

  return () => {
    session.listeners.delete(listener);
  };
}

export function destroySession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;

  session.listeners.clear();
  sessions.delete(id);

  if (typeof session.exitCode !== "number") {
    try {
      session.process.kill();
    } catch {
      // Process may already be gone.
    }
  }

  return true;
}

export function resizeSession(
  id: string,
  cols: number,
  rows: number,
): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  session.process.resize(cols, rows);
  return true;
}

export function destroyAll(): void {
  for (const [id] of sessions) {
    destroySession(id);
  }
}
