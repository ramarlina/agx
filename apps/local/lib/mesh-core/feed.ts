import type { FeedEntry } from "./types";
import { readJournal } from "./journal";
import { readReactions, readComments, readReactionsFor, readCommentsFor } from "./reactions";
import { listAgents } from "./agent";

/** Build a feed for an agent — what they see from the team */
export function buildFeed(
  agentId: string,
  options?: { mine?: boolean; limit?: number; since?: string }
): FeedEntry[] {
  const limit = options?.limit ?? 20;
  const since = options?.since ? new Date(options.since).getTime() : 0;
  const entries: FeedEntry[] = [];

  const agents = options?.mine ? [agentId] : listAgents();

  // Collect journal posts from relevant agents
  for (const agent of agents) {
    for (const entry of readJournal(agent)) {
      const t = new Date(entry.t).getTime();
      if (t >= since) {
        entries.push({ kind: "post", entry, agent });
      }
    }
  }

  // Collect ALL reactions and comments across ALL agents (team-wide)
  if (!options?.mine) {
    for (const agent of listAgents()) {
      for (const r of readReactions(agent)) {
        const t = new Date(r.t).getTime();
        if (t >= since) entries.push({ kind: "reaction", reaction: r });
      }
      for (const c of readComments(agent)) {
        const t = new Date(c.t).getTime();
        if (t >= since) entries.push({ kind: "comment", comment: c });
      }
    }
  }

  // Sort by timestamp, most recent first
  entries.sort((a, b) => {
    const tA = getTimestamp(a);
    const tB = getTimestamp(b);
    return tB - tA;
  });

  return entries.slice(0, limit);
}

function getTimestamp(entry: FeedEntry): number {
  switch (entry.kind) {
    case "post": return new Date(entry.entry.t).getTime();
    case "reaction": return new Date(entry.reaction.t).getTime();
    case "comment": return new Date(entry.comment.t).getTime();
    case "activity": return new Date(entry.event.t).getTime();
  }
}
