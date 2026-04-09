import fs from "fs";
import os from "os";
import path from "path";

const AGX_DATA_DIR = process.env.AGX_DATA_DIR || path.join(os.homedir(), ".agx");
const DEBUG_LOG_PATH =
  process.env.AGX_DEBUG_LOG_PATH ||
  path.join(AGX_DATA_DIR, "logs", "desktop-chat-debug.log");

function ensureLogDir() {
  fs.mkdirSync(path.dirname(DEBUG_LOG_PATH), { recursive: true });
}

function safeReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (typeof value === "string" && value.length > 2000) {
    return `${value.slice(0, 2000)}...<truncated>`;
  }
  return value;
}

export function getDebugLogPath(): string {
  return DEBUG_LOG_PATH;
}

export function writeDebugLog(event: string, payload?: Record<string, unknown>) {
  try {
    ensureLogDir();
    const line = JSON.stringify(
      {
        ts: new Date().toISOString(),
        pid: process.pid,
        event,
        ...(payload ? { payload } : {}),
      },
      safeReplacer
    );
    fs.appendFileSync(DEBUG_LOG_PATH, `${line}\n`, "utf8");
  } catch {
    // Debug logging must never break the request path.
  }
}
