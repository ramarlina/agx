import { generateRecap } from "./generator";

export type RecapJobStatus = "queued" | "running" | "failed";

export interface RecapJobState {
  status: RecapJobStatus;
  startedAt: number;
  error?: string;
}

export interface RunnerOptions {
  generate: (issueId: string) => Promise<void>;
  failureHoldMs?: number;
}

export interface Runner {
  enqueue(issueId: string): RecapJobState;
  get(issueId: string): RecapJobState | null;
}

export function createRunner(options: RunnerOptions): Runner {
  const failureHoldMs = options.failureHoldMs ?? 60_000;
  const state = new Map<string, RecapJobState>();

  function setState(issueId: string, next: RecapJobState | null) {
    if (next) {
      state.set(issueId, next);
    } else {
      state.delete(issueId);
    }
  }

  async function run(issueId: string) {
    setState(issueId, { status: "running", startedAt: Date.now() });
    try {
      await options.generate(issueId);
      setState(issueId, null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState(issueId, {
        status: "failed",
        startedAt: Date.now(),
        error: message,
      });
      setTimeout(() => {
        const current = state.get(issueId);
        if (current?.status === "failed") {
          state.delete(issueId);
        }
      }, failureHoldMs);
    }
  }

  return {
    enqueue(issueId: string): RecapJobState {
      const existing = state.get(issueId);
      if (existing && existing.status !== "failed") {
        return existing;
      }
      const next: RecapJobState = { status: "queued", startedAt: Date.now() };
      state.set(issueId, next);
      void Promise.resolve().then(() => run(issueId));
      return next;
    },
    get(issueId: string): RecapJobState | null {
      return state.get(issueId) ?? null;
    },
  };
}

let _defaultRunner: Runner | null = null;
export function getDefaultRunner(): Runner {
  if (!_defaultRunner) {
    _defaultRunner = createRunner({ generate: generateRecap });
  }
  return _defaultRunner;
}
