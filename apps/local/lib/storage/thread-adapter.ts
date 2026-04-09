import type { GroupMessage } from "../types";

/**
 * Lifecycle status for a conversation thread.
 */
export type ThreadStatus = "active" | "paused" | "in-review" | "done" | "archived";

/**
 * Arbitrary metadata that can be stored alongside a thread for sorting/filtering.
 */
export type ThreadMetadata = Record<string, unknown>;

/**
 * The canonical representation of a conversation thread in agx-chat.
 */
export interface Thread {
  /** Unique identifier for the thread. */
  id: string;
  /** Human-friendly title (optional). */
  title?: string;
  /** Ordered messages that belong to the thread. */
  messages: GroupMessage[];
  /** Denotes when the thread was created (epoch ms). */
  createdAt: number;
  /** Denotes the last time the thread was updated (epoch ms). */
  updatedAt: number;
  /** Optional metadata bucket adapters can use for sorting/filtering. */
  metadata?: ThreadMetadata;
  /** Lifecycle status of the thread. Defaults to "active". */
  status?: ThreadStatus;
  /** Free-text outcome note. */
  outcomeNote?: string;
  /** Optional project assignment for routing. */
  projectId?: string | null;
  /** @deprecated Legacy alias retained for older local thread payloads. */
  teamId?: string | null;
}

/**
 * Input data that is required when creating or updating a thread.
 * Adapters may enrich this input with timestamps or derived metadata before persistence.
 */
export interface SaveThreadInput extends Omit<Thread, "createdAt" | "updatedAt"> {
  /** Allow callers to override the created timestamp when reconstructing archives. */
  createdAt?: number;
  /** Allow callers to override the updated timestamp when reconstructing archives. */
  updatedAt?: number;
}

/**
 * Pagination and sort hints that adapters should honor when listing threads.
 */
export interface ThreadListOptions {
  /** Maximum number of threads to return. Defaults to all available threads. */
  limit?: number;
  /** Number of threads to skip before collecting results (offset-style cursor). */
  offset?: number;
  /** Sort order for the threads based on `updatedAt`. Defaults to "desc" (newest first). */
  order?: "asc" | "desc";
}

/**
 * Result payload for `listThreads` that includes the requested subset and the total size.
 */
export interface ListThreadsResult {
  /** Threads for the current page. */
  threads: Thread[];
  /** Total number of available threads (before paging). */
  total: number;
}

/**
 * Abstraction over storage mechanisms that persist conversation threads.
 */
export interface ThreadAdapter {
  /**
   * Persist a thread. Implementations should update timestamps and return the stored result.
   */
  saveThread(input: SaveThreadInput): Promise<Thread>;

  /**
   * Load a thread by its `id`. Return `null` when the thread does not exist.
   */
  loadThread(threadId: string): Promise<Thread | null>;

  /**
   * List persisted threads with optional pagination/sorting hints.
   */
  listThreads(options?: ThreadListOptions): Promise<ListThreadsResult>;

  /**
   * Remove a persisted thread. The method should be idempotent.
   */
  deleteThread(threadId: string): Promise<void>;
}
