import { NextRequest } from "next/server";
import { getMessageThread, loadHistory } from "@/lib/history-store";
import { extractKnowledgeFromThread } from "@/lib/thread-knowledge";
import {
  completeThreadKnowledgeRun,
  failThreadKnowledgeRun,
  getLatestThreadKnowledgeRun,
  startThreadKnowledgeRun,
  type ThreadKnowledgeScope,
} from "@/lib/thread-knowledge-runs";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SCOPES = new Set<ThreadKnowledgeScope>(["repo", "project"]);

export async function GET(request: NextRequest) {
  const rootMessageId = request.nextUrl.searchParams.get("rootMessageId")?.trim() || "";
  if (!rootMessageId) {
    return Response.json({ error: "rootMessageId is required" }, { status: 400 });
  }

  const run = getLatestThreadKnowledgeRun(rootMessageId);
  return Response.json({ ok: true, run });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rootMessageId = typeof body?.rootMessageId === "string" ? body.rootMessageId.trim() : "";
    const scopes = Array.isArray(body?.scopes)
      ? body.scopes
        .map((scope: unknown) => (typeof scope === "string" ? scope.trim() : ""))
        .filter((scope: string): scope is ThreadKnowledgeScope => VALID_SCOPES.has(scope as ThreadKnowledgeScope))
      : [];

    if (!rootMessageId || scopes.length === 0) {
      return Response.json({ error: "rootMessageId and at least one valid scope are required" }, { status: 400 });
    }

    const thread = await getMessageThread(rootMessageId);
    if (!thread) {
      return Response.json({ error: "Thread not found" }, { status: 404 });
    }

    const history = await loadHistory(thread.threadId);
    const root = history.find((message) => message.id === rootMessageId);
    if (!root) {
      return Response.json({ error: "Root message not found" }, { status: 404 });
    }

    const { run, reused } = startThreadKnowledgeRun({
      threadId: thread.threadId,
      rootMessageId,
      scopes,
    });

    if (!reused) {
      void extractKnowledgeFromThread({
        threadId: thread.threadId,
        rootMessageId,
        status: root.threadStatus ?? "active",
        outcomeNote: root.outcomeNote ?? null,
        scopes,
      })
        .then((result) => {
          completeThreadKnowledgeRun({
            runId: run.id,
            repoInsertedCount: result.repoInsertedCount,
            projectInsertedCount: result.projectInsertedCount,
          });
        })
        .catch((error) => {
          console.warn("[threads/knowledge] Manual thread knowledge extraction failed:", error);
          failThreadKnowledgeRun(run.id, error instanceof Error ? error.message : "Manual thread knowledge extraction failed");
        });
    }

    return Response.json({
      ok: true,
      accepted: true,
      reused,
      rootMessageId,
      scopes,
      run,
    });
  } catch (error) {
    logger.error("Error starting manual thread knowledge extraction", logger.formatError(error));
    return Response.json({ error: "Failed to start manual knowledge extraction" }, { status: 500 });
  }
}
