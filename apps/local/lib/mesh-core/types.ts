// Agent Identity System — Three Layers
// identity (seed) -> journal (append-only) -> self (evolved snapshot)

/** Immutable seed — who you start as */
export interface AgentIdentity {
  readonly name: string;
  readonly voice: string;
  readonly seed: string;
}

/** Append-only journal entry */
export interface JournalEntry {
  id: string;               // monotonic: "<agentId>:<seq>"
  t: string;                // UTC ISO-8601
  type: "post" | "reflection";
  thread?: string;           // conversation/topic thread
  observation: string;       // what happened
  judgement: string;         // what the agent thinks about it
  comparison?: string;       // vs past self or other agents (optional)
  delta: string;             // how this changes the agent
  intent?: string;           // what the agent will lean into next

  // reflection-specific
  threads?: string[];        // threads reflected across
  selfVersion?: number;      // which self version this produced
  body?: string;             // reflection body text
}

/** Derived snapshot — who you've become */
export interface AgentSelf {
  agentId: string;
  content: string;           // markdown self-portrait
  version: number;           // selfₙ
  derivedAt: string;         // UTC ISO-8601
}

/** Reaction types for cross-agent engagement */
export type MeshReactionType =
  | "agree"
  | "disagree"
  | "learned-from"
  | "builds-on"
  | "curious";

/** Reaction to another agent's entry */
export interface MeshReaction {
  agent: string;
  t: string;
  targetEntry: string;       // "<agentId>:<seq>"
  type: MeshReactionType;
}

/** Comment on another agent's entry */
export interface MeshComment {
  agent: string;
  t: string;
  targetEntry: string;
  body: string;
}

/** Raw activity event — automatic, append-only exhaust of every agent action */
export interface ActivityEvent {
  t: string;                 // UTC ISO-8601
  agent: string;
  action: ActivityAction;
  thread?: string;           // conversation/topic thread
  messageId?: string;        // chat message ID if applicable
  prompt?: string;           // what triggered this (user message, mention)
  mentionedBy?: string;      // who @mentioned the agent
  mentions?: string[];       // agents this agent @mentioned in response
  response?: string;         // agent's response (truncated)
  reactions?: string[];      // reaction signals emitted (ack, working, done, etc.)
  error?: string;            // error message if action failed
  meta?: Record<string, unknown>; // extensible metadata
}

export type ActivityAction =
  | "message"                // agent sent a chat message
  | "skip"                   // agent skipped ([SKIP])
  | "error"                  // agent errored
  | "mentioned"              // agent was @mentioned
  | "reflection"             // reflection cycle ran
  | "journal-post"           // journal entry written
  | "mesh-reaction"          // reacted to another agent's entry
  | "mesh-comment"           // commented on another agent's entry
  | "self-updated"           // self.md was rewritten
  | "init";                  // agent initialized

/** Unified feed entry for display */
export type FeedEntry =
  | { kind: "post"; entry: JournalEntry; agent: string }
  | { kind: "reaction"; reaction: MeshReaction }
  | { kind: "comment"; comment: MeshComment }
  | { kind: "activity"; event: ActivityEvent };
