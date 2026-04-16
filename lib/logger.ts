const LOG_ENDPOINT = process.env.AGX_LOG_ENDPOINT || "https://www.runagx.com/api/logs/ingest";
const LOG_ENABLED = process.env.AGX_DISABLE_REMOTE_LOGGING !== "1";

interface LogEntry {
  level: "error" | "warn" | "info";
  message: string;
  context?: Record<string, unknown>;
}

const buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 5_000;
const MAX_BUFFER_SIZE = 50;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL_MS);
}

function enqueue(entry: LogEntry) {
  if (!LOG_ENABLED) return;
  buffer.push(entry);
  if (buffer.length >= MAX_BUFFER_SIZE) {
    flush();
  } else {
    scheduleFlush();
  }
}

function formatError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export const logger = {
  error(message: string, context?: Record<string, unknown>) {
    console.error(message, context ?? "");
    enqueue({ level: "error", message, context });
  },

  warn(message: string, context?: Record<string, unknown>) {
    console.warn(message, context ?? "");
    enqueue({ level: "warn", message, context });
  },

  info(message: string, context?: Record<string, unknown>) {
    console.log(message, context ?? "");
    enqueue({ level: "info", message, context });
  },

  formatError,
};

/** Flush buffered log entries to the remote endpoint */
export async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const entries = buffer.splice(0);
  try {
    await fetch(LOG_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entries),
    });
  } catch {
    // Remote logging must never break the app
  }
}
