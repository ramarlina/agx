import * as pty from "node-pty";

export interface PtySession {
  id: string;
  process: pty.IPty;
  createdAt: number;
}

const sessions = new Map<string, PtySession>();

const defaultShell =
  process.platform === "win32"
    ? "powershell.exe"
    : process.env.SHELL || "/bin/zsh";

export function createSession(
  id: string,
  cwd?: string,
): PtySession {
  const proc = pty.spawn(defaultShell, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: cwd || process.env.HOME || "/",
    env: { ...process.env } as Record<string, string>,
  });

  const session: PtySession = { id, process: proc, createdAt: Date.now() };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string): PtySession | undefined {
  return sessions.get(id);
}

export function destroySession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  session.process.kill();
  sessions.delete(id);
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
