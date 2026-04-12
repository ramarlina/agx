export type TerminalStatus = "connecting" | "active" | "exited" | "error";

export interface TerminalInstance {
  id: string;
  title: string;
  cwd?: string;
  createdAt: number;
  sessionId?: string;
  status: TerminalStatus;
  command?: string;
  colSpan: number;
  rowSpan: number;
}

export interface TerminalSession {
  id: string;
  title: string;
  createdAt: number;
  terminals: TerminalInstance[];
}

export function getTerminalSessionStatus(
  session: TerminalSession,
): TerminalStatus {
  const statuses = session.terminals.map((terminal) => terminal.status);
  if (statuses.includes("active")) return "active";
  if (statuses.includes("connecting")) return "connecting";
  if (statuses.includes("error")) return "error";
  return "exited";
}
