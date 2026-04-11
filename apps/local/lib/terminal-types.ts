export interface TerminalTab {
  id: string;
  title: string;
  cwd?: string;
  createdAt: number;
  /** PTY session ID returned by the backend */
  sessionId?: string;
}
