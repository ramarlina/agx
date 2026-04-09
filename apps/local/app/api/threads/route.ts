import { NextRequest } from "next/server";
import { listRootMessages, getWorkspaceNames, updateMessageStatus, getMessageThread, getProjectThreadIds, loadHistory } from "@/lib/history-store";
import type { ThreadStatus } from "@/lib/storage";
import { extractKnowledgeFromThreadTransition } from "@/lib/thread-knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const VALID_STATUSES = new Set<ThreadStatus>([
  "active",
  "paused",
  "in-review",
  "done",
  "archived",
]);

function parseBoundedInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

function titleFromContent(content: string): string {
  const plain = content
    .replace(/\[agx:spawn\]\s*/g, "")
    .replace(/\s*\[agx:exit:\d+\]\s*/g, "")
    .replace(/\[reaction[^\]]*\]/g, "")
    .replace(/\[SKIP\]/g, "")
    .trim();
  const firstLine = plain.split("\n")[0] || "(untitled)";
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine;
}

interface ThreadEntry {
  id: string;
  threadId: string;
  title: string;
  status: string;
  replyCount: number;
  createdAt: number;
  lastActivity: number;
  outcomeNote: string | null;
}

interface WorkspaceGroup {
  name: string;
  threads: ThreadEntry[];
}

function groupByWorkspace(threads: ThreadEntry[], workspaceNames: Record<string, string>): Record<string, WorkspaceGroup> {
  const groups: Record<string, WorkspaceGroup> = {};
  for (const t of threads) {
    const key = t.threadId || "(default)";
    if (!groups[key]) {
      groups[key] = { name: workspaceNames[key] || key, threads: [] };
    }
    groups[key].threads.push(t);
  }
  return groups;
}

function formatMarkdown(threads: ThreadEntry[], workspaceNames: Record<string, string>): string {
  if (threads.length === 0) return "No threads found.";

  const lines: string[] = [];
  lines.push(`# Threads (${threads.length})`);
  lines.push("");

  const groups = groupByWorkspace(threads, workspaceNames);
  for (const [, group] of Object.entries(groups)) {
    lines.push(`## ${group.name}`);
    lines.push("");
    for (const t of group.threads) {
      lines.push(`- **${t.title}**`);
      lines.push(`  id: ${t.id}`);
      lines.push(`  status: ${t.status}`);
      lines.push(`  replies: ${t.replyCount}`);
      lines.push(`  updated: ${formatTimestamp(t.lastActivity)}`);
      if (t.outcomeNote) lines.push(`  outcome: ${t.outcomeNote}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { rootMessageId, status, outcomeNote } = body;

    if (!rootMessageId || !status) {
      return Response.json({ error: "rootMessageId and status are required" }, { status: 400 });
    }

    if (!VALID_STATUSES.has(status as ThreadStatus)) {
      return Response.json(
        { error: `Invalid status. Valid values: ${[...VALID_STATUSES].join(", ")}` },
        { status: 400 }
      );
    }

    const thread = await getMessageThread(rootMessageId);
    if (!thread) {
      return Response.json({ error: "Thread not found" }, { status: 404 });
    }

    const history = await loadHistory(thread.threadId);
    const root = history.find((message) => message.id === rootMessageId);
    const previousStatus = root?.threadStatus ?? "active";

    await updateMessageStatus(thread.threadId, rootMessageId, status, outcomeNote ?? null);

    if (previousStatus !== status) {
      extractKnowledgeFromThreadTransition({
        threadId: thread.threadId,
        rootMessageId,
        fromStatus: previousStatus,
        toStatus: status,
        outcomeNote: outcomeNote ?? null,
      }).catch((error) => {
        console.warn("[threads/PATCH] Thread knowledge extraction failed:", error);
      });
    }

    return Response.json({ ok: true, rootMessageId, status, outcomeNote: outcomeNote ?? null });
  } catch (error) {
    console.error("Error updating thread status:", error);
    return Response.json({ error: "Failed to update thread status" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const statusParam = searchParams.get("status")?.trim().toLowerCase();
    const format = searchParams.get("format")?.trim().toLowerCase();
    const projectId = searchParams.get("projectId")?.trim();

    const limit = parseBoundedInt(searchParams.get("limit"), DEFAULT_LIMIT);
    const offset = Math.max(0, Number.parseInt(searchParams.get("offset") ?? "0", 10) || 0);

    if (statusParam && !VALID_STATUSES.has(statusParam as ThreadStatus)) {
      return Response.json(
        { error: `Invalid status. Valid values: ${[...VALID_STATUSES].join(", ")}` },
        { status: 400 }
      );
    }

    // If projectId provided, filter threads to only those scoped to this project
    let projectThreadIds: Set<string> | undefined;
    if (projectId) {
      const ids = await getProjectThreadIds(projectId);
      projectThreadIds = new Set(ids);
    }

    const { rows, total } = await listRootMessages({
      status: statusParam || undefined,
      limit: projectId ? MAX_LIMIT : limit, // fetch more when filtering by project
      offset: projectId ? 0 : offset,
    });

    let threads: ThreadEntry[] = rows.map((r) => ({
      id: r.id,
      threadId: r.thread_id,
      title: titleFromContent(r.content),
      status: r.thread_status ?? "active",
      replyCount: r.reply_count,
      createdAt: r.timestamp,
      lastActivity: r.last_activity,
      outcomeNote: r.outcome_note,
    }));

    // Filter to project-scoped threads if projectId provided
    if (projectThreadIds) {
      threads = threads.filter((t) => projectThreadIds!.has(t.threadId));
    }

    // Apply pagination after project filtering
    const filteredTotal = projectId ? threads.length : total;
    if (projectId) {
      threads = threads.slice(offset, offset + limit);
    }

    const workspaceIds = [...new Set(threads.map((t) => t.threadId).filter(Boolean))];
    const workspaceNames = await getWorkspaceNames(workspaceIds);

    if (format === "json") {
      return Response.json({ threads: groupByWorkspace(threads, workspaceNames), total: filteredTotal, limit, offset });
    }

    return new Response(formatMarkdown(threads, workspaceNames), {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  } catch (error) {
    console.error("Error fetching threads:", error);
    return Response.json({ error: "Failed to fetch threads" }, { status: 500 });
  }
}
