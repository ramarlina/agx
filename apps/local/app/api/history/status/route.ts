import { NextRequest } from "next/server";
import { getAttachmentsForMessages } from "@/lib/attachment-store";
import {
  getMessageThread,
  getThreadStatusSnapshot,
  sweepStaleWorkingReactions,
  loadLogsByProcessPids,
} from "@/lib/history-store";
import type { ProcessLogEntry } from "@/lib/history-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function parseBoundedInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

function readRootMessageIdFromRequest(request: NextRequest): string {
  return request.nextUrl.searchParams.get("rootMessageId")?.trim() ?? "";
}

function normalizeMultiline(text: string): string {
  return (text ?? "").replace(/\r\n/g, "\n");
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace("T", " ").slice(0, 19);
}

function pushIndentedBlock(lines: string[], text: string, indentSize: number): void {
  const normalized = normalizeMultiline(text);
  const blockLines = normalized.length > 0 ? normalized.split("\n") : [""];
  const indent = " ".repeat(indentSize);
  for (const line of blockLines) {
    lines.push(`${indent}${line}`);
  }
}

function pushProcessMessage(lines: string[], process: any, indentSize: number): void {
  const pid = typeof process.processId === "number" ? String(process.processId) : "-";
  const responseTs = formatTimestamp(process.datetime);
  const responseContent =
    typeof process.responseContent === "string" && process.responseContent.length > 0
      ? process.responseContent
      : "-";
  const indent = " ".repeat(indentSize);
  lines.push(`${indent}**${process.agent}** | PID ${pid} | ${process.status} | ${responseTs}`);
  pushIndentedBlock(lines, responseContent, indentSize + 2);
  lines.push("");
}

function stripAgxMarkers(text: string): string {
  return text
    .replace(/\[agx:spawn\]\s*/g, "")
    .replace(/\s*\[agx:exit:\d+\]\s*/g, "")
    .trim();
}

function formatMarkdown(rootMessageId: string, snapshot: any, opts?: { full?: boolean }): string {
  const lines: string[] = [];

  // Root message
  const root = snapshot.rootMessage;
  const rootSenderName = root.participantId ?? root.role;
  const rootContent = stripAgxMarkers(root.content);

  lines.push(`# Thread ${rootMessageId.slice(0, 8)}`);
  lines.push("");
  lines.push("## Initial Request");
  lines.push("");
  lines.push(`**${rootSenderName}** (${formatTimestamp(root.timestamp)}):`);
  pushIndentedBlock(lines, rootContent, 2);
  lines.push("");
  lines.push("## Messages");
  lines.push("");

  // Use the messages array (all messages in chrono order, agx markers already stripped)
  const msgs = (snapshot.messages || []) as Array<{
    id: string;
    role: string;
    participantId: string | null;
    content: string;
    timestamp: number;
    parentMessageId: string | null;
    processId: number | null;
    status: string | null;
  }>;

  // Skip the root message itself (already shown above)
  for (const msg of msgs) {
    if (msg.id === root.id) continue;

    const sender = msg.participantId ?? msg.role;
    const ts = formatTimestamp(msg.timestamp);

    if (msg.role === "user") {
      // User messages at indent 0
      lines.push(`**${sender}** (${ts}):`);
      pushIndentedBlock(lines, msg.content, 2);
      lines.push("");
    } else {
      // Agent messages indented with metadata
      const pid = typeof msg.processId === "number" ? String(msg.processId) : "-";
      const status = msg.status || "done";
      lines.push(`  **${sender}** | PID ${pid} | ${status} | ${ts}`);
      pushIndentedBlock(lines, msg.content, 4);
      lines.push("");
    }
  }

  // Processes table (last N)
  const processes = (snapshot.processes || []) as Array<{
    processId: number | null;
    datetime: number;
    agent: string;
    status: string;
    responseTo: string;
    responseToSenderName: string;
    responseToSenderRole: string;
    responseContent: string | null;
  }>;
  if (processes.length > 0) {
    lines.push(`## Processes (${processes.length})`);
    lines.push("");
    for (const p of processes) {
      const pid = typeof p.processId === "number" ? String(p.processId) : "-";
      const ts = formatTimestamp(p.datetime);
      const senderName = p.responseToSenderName || "user";
      const respondingTo = stripAgxMarkers(p.responseTo || "-");
      const isMultiline = respondingTo.includes("\n");
      lines.push(`- pid: ${pid}`);
      lines.push(`  agent: ${p.agent}`);
      lines.push(`  status: ${p.status}`);
      lines.push(`  time: ${ts}`);
      if (isMultiline) {
        lines.push(`  respondingTo: |`);
        for (const rl of respondingTo.split("\n")) {
          lines.push(`    ${rl}`);
        }
      } else {
        lines.push(`  respondingTo: ${respondingTo}`);
      }
      lines.push(`  respondingToSender: ${senderName}`);
      const content = p.responseContent ? stripAgxMarkers(p.responseContent) : null;
      if (content) {
        lines.push(`  responseContent: |`);
        for (const cl of content.split("\n")) {
          lines.push(`    ${cl}`);
        }
      }
      lines.push("");
    }
  }

  // Build logs lookup by PID
  const logsByPid = new Map<number, Array<{ timestamp: number; stream: string; line: string }>>();
  for (const log of (snapshot.logs || []) as Array<{ processId: number; agent: string; stream: string; line: string; timestamp: number }>) {
    let arr = logsByPid.get(log.processId);
    if (!arr) { arr = []; logsByPid.set(log.processId, arr); }
    arr.push(log);
  }

  const LOG_TAIL = opts?.full ? Infinity : 20;

  // Running section
  const runningProcs = processes.filter((p) => p.status === "running");
  if (runningProcs.length > 0) {
    lines.push("## Running");
    lines.push("");
    for (const p of runningProcs) {
      const pid = typeof p.processId === "number" ? String(p.processId) : "-";
      const ts = formatTimestamp(p.datetime);
      const senderName = p.responseToSenderName || "user";
      const respondingTo = stripAgxMarkers(p.responseTo || "-");
      const isMultiline = respondingTo.includes("\n");
      lines.push(`- pid: ${pid}`);
      lines.push(`  agent: ${p.agent}`);
      lines.push(`  status: running`);
      lines.push(`  time: ${ts}`);
      if (isMultiline) {
        lines.push(`  respondingTo: |`);
        for (const rl of respondingTo.split("\n")) {
          lines.push(`    ${rl}`);
        }
      } else {
        lines.push(`  respondingTo: ${respondingTo}`);
      }
      lines.push(`  respondingToSender: ${senderName}`);
      const content = p.responseContent ? stripAgxMarkers(p.responseContent) : null;
      if (content) {
        lines.push(`  responseContent: |`);
        for (const cl of content.split("\n")) {
          lines.push(`    ${cl}`);
        }
      }
      const pidLogs = typeof p.processId === "number" ? logsByPid.get(p.processId) : null;
      if (pidLogs && pidLogs.length > 0) {
        const tail = pidLogs.slice(-LOG_TAIL);
        lines.push(`  logs: |`);
        for (const l of tail) {
          lines.push(`    [${formatTimestamp(l.timestamp)}] ${l.stream}: ${l.line}`);
        }
      }
      lines.push("");
    }
  }

  // Failed section
  const failedProcs = processes.filter((p) => p.status === "failed");
  if (failedProcs.length > 0) {
    lines.push("## Failed");
    lines.push("");
    for (const p of failedProcs) {
      const pid = typeof p.processId === "number" ? String(p.processId) : "-";
      const ts = formatTimestamp(p.datetime);
      const senderName = p.responseToSenderName || "user";
      const respondingTo = stripAgxMarkers(p.responseTo || "-");
      const isMultiline = respondingTo.includes("\n");
      lines.push(`- pid: ${pid}`);
      lines.push(`  agent: ${p.agent}`);
      lines.push(`  status: failed`);
      lines.push(`  time: ${ts}`);
      if (isMultiline) {
        lines.push(`  respondingTo: |`);
        for (const rl of respondingTo.split("\n")) {
          lines.push(`    ${rl}`);
        }
      } else {
        lines.push(`  respondingTo: ${respondingTo}`);
      }
      lines.push(`  respondingToSender: ${senderName}`);
      const content = p.responseContent ? stripAgxMarkers(p.responseContent) : null;
      if (content) {
        lines.push(`  responseContent: |`);
        for (const cl of content.split("\n")) {
          lines.push(`    ${cl}`);
        }
      }
      const pidLogs = typeof p.processId === "number" ? logsByPid.get(p.processId) : null;
      if (pidLogs && pidLogs.length > 0) {
        const tail = pidLogs.slice(-LOG_TAIL);
        lines.push(`  logs: |`);
        for (const l of tail) {
          lines.push(`    [${formatTimestamp(l.timestamp)}] ${l.stream}: ${l.line}`);
        }
      }
      lines.push("");
    }
  }

  if (snapshot.lastUpdatedAt) {
    lines.push(`---`);
    lines.push(`*Last updated: ${new Date(snapshot.lastUpdatedAt).toISOString()}*`);
  }

  return lines.join("\n");
}

export async function GET(request: NextRequest) {
  const rootMessageId = readRootMessageIdFromRequest(request);
  if (!rootMessageId) {
    return Response.json({ error: "rootMessageId is required" }, { status: 400 });
  }

  const threadRef = await getMessageThread(rootMessageId);
  if (!threadRef) {
    return Response.json({ error: "Root message not found" }, { status: 404 });
  }

  const full = request.nextUrl.searchParams.get("full")?.trim().toLowerCase() === "true";
  const messageLimit = full ? undefined : parseBoundedInt(
    request.nextUrl.searchParams.get("messageLimit"),
    DEFAULT_LIMIT
  );
  const processLimit = full ? undefined : parseBoundedInt(
    request.nextUrl.searchParams.get("processLimit"),
    DEFAULT_LIMIT
  );

  await sweepStaleWorkingReactions(threadRef.threadId);
  const snapshot = await getThreadStatusSnapshot({
    threadId: threadRef.threadId,
    rootMessageId,
    ...(messageLimit !== undefined && { messageLimit }),
    ...(processLimit !== undefined && { processLimit }),
  });

  if (!snapshot.rootMessage) {
    return Response.json({ error: "Root message not found" }, { status: 404 });
  }

  const attachmentMap = await getAttachmentsForMessages([snapshot.rootMessage.id]);
  const rootAttachments = attachmentMap.get(snapshot.rootMessage.id);
  if (rootAttachments && rootAttachments.length > 0) {
    snapshot.rootMessage.attachments = rootAttachments;
  }

  // Fetch logs for running or failed processes
  const loggablePids = snapshot.processes
    .filter((p: any) => (p.status === "running" || p.status === "failed") && p.processId != null)
    .map((p: any) => p.processId as number);
  const logs: ProcessLogEntry[] =
    loggablePids.length > 0 ? await loadLogsByProcessPids(loggablePids) : [];

  const jsonBody = {
    threadId: threadRef.threadId,
    rootMessageId: snapshot.rootMessage.id,
    rootMessage: snapshot.rootMessage,
    messages: snapshot.messages,
    processes: snapshot.processes,
    logs,
    lastUpdatedAt: snapshot.lastUpdatedAt,
  };

  const format = request.nextUrl.searchParams.get("format")?.trim().toLowerCase();
  const userAgent = request.headers.get("user-agent")?.toLowerCase() ?? "";
  const useCompactByDefault = !format && userAgent.includes("curl/");
  const activeProcessCount = snapshot.processes.filter(
    (p: any) => p.status === "running",
  ).length;
  const messageCount = Array.isArray(snapshot.messages) ? snapshot.messages.length : 0;
  const compactBody = {
    activeProcessCount,
    lastMessageAt: snapshot.lastUpdatedAt,
    messageCount,
    threadId: threadRef.threadId,
    threadStatus: snapshot.rootMessage.threadStatus ?? null,
    outcomeNote: snapshot.rootMessage.outcomeNote ?? null,
    rootMessageId: snapshot.rootMessage.id,
    processes: snapshot.processes.map((p: any) => ({
      agent: p.agent,
      status: p.status,
      datetime: p.datetime,
    })),
  };

  // Compact JSON: lightweight payload for function nodes in execution graphs
  if (format === "compact" || useCompactByDefault) {
    return Response.json(compactBody);
  }

  if (format === "json") {
    return Response.json(jsonBody);
  }

  // Markdown is the default
  return new Response(formatMarkdown(snapshot.rootMessage.id, jsonBody, { full }), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
