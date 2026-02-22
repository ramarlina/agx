import type { ThreadAdapter, ThreadPayload } from './thread-adapter';

/**
 * Configuration options for {@link LocalThreadAdapter}.
 */
export interface LocalThreadAdapterOptions {
  /**
   * Override the default localStorage key prefix (defaults to `@agx/thread:`).
   */
  keyPrefix?: string;
  /**
   * Inject a storage implementation (useful for tests or non-browser hosts).
   * When omitted, the implementation falls back to `window.localStorage` /
   * `globalThis.localStorage` if available.
   */
  storage?: Storage;
}

const DEFAULT_KEY_PREFIX = '@agx/thread:';

/**
 * Browser-backed thread adapter that persists payloads into `localStorage`.
 */
export class LocalThreadAdapter<TThread = ThreadPayload> implements ThreadAdapter<TThread> {
  private readonly storageKeyPrefix: string;
  private readonly storage?: Storage;

  constructor(options: LocalThreadAdapterOptions = {}) {
    const prefix = options.keyPrefix?.trim() || DEFAULT_KEY_PREFIX;
    // Ensure every persisted item uses a consistent prefix so key scans stay reliable.
    this.storageKeyPrefix = prefix.endsWith(':') ? prefix : `${prefix}:`;
    this.storage = options.storage ?? LocalThreadAdapter.resolveStorage();
  }

  async saveThread(threadId: string, thread: TThread): Promise<void> {
    const storage = this.storage;
    if (!storage) {
      return;
    }

    try {
      storage.setItem(this.buildKey(threadId), JSON.stringify(thread));
    } catch (error) {
      this.logError('saveThread', error, threadId);
    }
  }

  async loadThread(threadId: string): Promise<TThread | null> {
    const storage = this.storage;
    if (!storage) {
      return null;
    }

    const raw = storage.getItem(this.buildKey(threadId));
    if (raw === null) {
      return null;
    }

    try {
      return JSON.parse(raw) as TThread;
    } catch (error) {
      this.logError('loadThread', error, threadId);
      return null;
    }
  }

  async listThreads(): Promise<string[]> {
    const storage = this.storage;
    if (!storage) {
      return [];
    }

    const threads: string[] = [];
    for (let idx = 0; idx < storage.length; idx += 1) {
      const key = storage.key(idx);
      if (!key || !key.startsWith(this.storageKeyPrefix)) {
        continue;
      }
      const id = key.slice(this.storageKeyPrefix.length);
      threads.push(id);
    }

    return threads;
  }

  async deleteThread(threadId: string): Promise<void> {
    const storage = this.storage;
    if (!storage) {
      return;
    }

    try {
      storage.removeItem(this.buildKey(threadId));
    } catch (error) {
      this.logError('deleteThread', error, threadId);
    }
  }

  private buildKey(threadId: string): string {
    // Thread payloads are scoped by the configured prefix to avoid cross-feature collisions.
    return `${this.storageKeyPrefix}${threadId}`;
  }

  private static resolveStorage(): Storage | undefined {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }

    if (typeof globalThis !== 'undefined') {
      const maybeStorage = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
      if (maybeStorage) {
        return maybeStorage;
      }
    }

    return undefined;
  }

  private logError(action: string, error: unknown, threadId?: string): void {
    if (typeof console === 'undefined' || typeof console.warn !== 'function') {
      return;
    }

    const label = threadId ? `${action}(${threadId})` : action;
    console.warn(`[LocalThreadAdapter] ${label} failed`, error);
  }
}
