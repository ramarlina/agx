import type { ChatEvent } from "./types";

interface StreamState {
  events: ChatEvent[];
  subscribers: Set<(event: ChatEvent) => void>;
  done: boolean;
}

const CLEANUP_DELAY_MS = 5 * 60 * 1000;

class ChatEventBus {
  private streams = new Map<string, StreamState>();

  publish(chatRunId: string, event: ChatEvent): void {
    let state = this.streams.get(chatRunId);
    if (!state) {
      state = { events: [], subscribers: new Set(), done: false };
      this.streams.set(chatRunId, state);
    }
    if (state.done) return;
    state.events.push(event);
    for (const subscriber of state.subscribers) {
      try {
        subscriber(event);
      } catch {
        // subscriber may have been cleaned up
      }
    }
  }

  subscribe(chatRunId: string, callback: (event: ChatEvent) => void): () => void {
    let state = this.streams.get(chatRunId);
    if (!state) {
      state = { events: [], subscribers: new Set(), done: false };
      this.streams.set(chatRunId, state);
    }
    // Replay buffered events
    for (const event of state.events) {
      try {
        callback(event);
      } catch {
        // subscriber error during replay
      }
    }
    if (!state.done) {
      state.subscribers.add(callback);
    }
    return () => {
      state!.subscribers.delete(callback);
    };
  }

  complete(chatRunId: string): void {
    const state = this.streams.get(chatRunId);
    if (!state) return;
    state.done = true;
    // Notify subscribers that the stream is done
    for (const subscriber of state.subscribers) {
      try {
        subscriber({ type: "done" });
      } catch {
        // ignore
      }
    }
    state.subscribers.clear();
    // Schedule cleanup of buffered events
    setTimeout(() => {
      this.streams.delete(chatRunId);
    }, CLEANUP_DELAY_MS);
  }

  isComplete(chatRunId: string): boolean {
    return this.streams.get(chatRunId)?.done ?? false;
  }
}

const GLOBAL_KEY = Symbol.for("agx:ChatEventBus");

export function getChatEventBus(): ChatEventBus {
  if (!(globalThis as any)[GLOBAL_KEY]) {
    (globalThis as any)[GLOBAL_KEY] = new ChatEventBus();
  }
  return (globalThis as any)[GLOBAL_KEY];
}