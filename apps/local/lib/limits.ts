/**
 * Operational limits from docs/LIMITS.md
 *
 * These constants enforce the single-coordinator / single-writer architecture.
 * Do not raise them without an architecture review.
 */

/** Maximum concurrent workers per coordinator */
export const MAX_WORKERS = Number(process.env.AGX_MAX_WORKERS) || 10;

/** Write QPS ceiling — warn when sustained rate exceeds this */
export const WRITE_QPS_WARNING_THRESHOLD = 40;

/** Write QPS hard ceiling documented in LIMITS.md */
export const WRITE_QPS_CEILING = 50;

/** Sampling window for write-rate monitoring (ms) */
export const WRITE_RATE_SAMPLE_WINDOW_MS = 10_000;

/**
 * Validate worker count against MAX_WORKERS.
 * Throws if the requested count exceeds the limit.
 */
export function assertWorkerCount(requested: number): void {
  if (requested > MAX_WORKERS) {
    throw new Error(
      `[limits] Requested ${requested} workers exceeds MAX_WORKERS (${MAX_WORKERS}). ` +
      `See docs/LIMITS.md — exceeding this limit risks SQLITE_BUSY errors. ` +
      `Set AGX_MAX_WORKERS to override (requires architecture review).`
    );
  }
  if (requested < 1) {
    throw new Error(`[limits] Worker count must be at least 1, got ${requested}.`);
  }
}

/**
 * Simple write-rate monitor. Call `record()` on each write, and periodically
 * call `check()` to log warnings when approaching the ceiling.
 */
export class WriteRateMonitor {
  private timestamps: number[] = [];
  private lastWarning = 0;
  private readonly WARNING_COOLDOWN_MS = 60_000;

  record(): void {
    this.timestamps.push(Date.now());
  }

  check(): { qps: number; warning: boolean } {
    const now = Date.now();
    const cutoff = now - WRITE_RATE_SAMPLE_WINDOW_MS;
    this.timestamps = this.timestamps.filter((t) => t >= cutoff);

    const qps = this.timestamps.length / (WRITE_RATE_SAMPLE_WINDOW_MS / 1000);
    const warning = qps >= WRITE_QPS_WARNING_THRESHOLD;

    if (warning && now - this.lastWarning > this.WARNING_COOLDOWN_MS) {
      this.lastWarning = now;
      console.warn(
        `[limits] Write QPS at ${qps.toFixed(1)} — approaching ceiling of ${WRITE_QPS_CEILING}. ` +
        `See docs/LIMITS.md for mitigation steps.`
      );
    }

    return { qps, warning };
  }
}
