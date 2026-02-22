/**
 * Core thread storage abstraction.
 *
 * Implementations persist thread payloads (messages, metadata, etc.) to
 * arbitrary backends while exposing a shared API for higher-level consumers.
 */

/**
 * Default payload type for threads when consumers do not need to constrain the shape.
 */
export type ThreadPayload = unknown;

/**
 * Minimal API surface required for a thread storage adapter.
 */
export interface ThreadAdapter<TThread = ThreadPayload> {
  /**
   * Persist the provided thread payload using the supplied identifier.
   */
  saveThread(threadId: string, thread: TThread): Promise<void>;

  /**
   * Read the payload that was previously stored for the identifier or `null`
   * when no data exists.
   */
  loadThread(threadId: string): Promise<TThread | null>;

  /**
   * List every thread identifier that has data persisted by this adapter.
   */
  listThreads(): Promise<string[]>;

  /**
   * Delete the payload tied to the identifier, if one exists.
   */
  deleteThread(threadId: string): Promise<void>;
}
