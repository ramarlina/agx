export interface TerminalSession {
  id: string;
  title: string;
  cwd?: string;
  createdAt: number;
  sessionId?: string;
  status: 'connecting' | 'active' | 'exited';
  command?: string;
}
