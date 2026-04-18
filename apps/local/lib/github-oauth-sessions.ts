import crypto from "node:crypto";

interface OAuthSession {
  projectId: string;
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000;

const sessions = new Map<string, OAuthSession>();

function prune(now: number): void {
  for (const [key, session] of sessions) {
    if (now - session.createdAt > TTL_MS) {
      sessions.delete(key);
    }
  }
}

export function createOAuthSession(projectId: string): string {
  const now = Date.now();
  prune(now);
  const token = crypto.randomBytes(16).toString("hex");
  sessions.set(token, { projectId, createdAt: now });
  return token;
}

export function consumeOAuthSession(token: string): OAuthSession | null {
  const now = Date.now();
  prune(now);
  const session = sessions.get(token);
  if (!session) return null;
  if (now - session.createdAt > TTL_MS) {
    sessions.delete(token);
    return null;
  }
  sessions.delete(token);
  return session;
}

export function peekOAuthSession(token: string): OAuthSession | null {
  const now = Date.now();
  prune(now);
  const session = sessions.get(token);
  if (!session) return null;
  if (now - session.createdAt > TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return session;
}

export function __clearOAuthSessionsForTest(): void {
  sessions.clear();
}
