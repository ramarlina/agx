import { NextRequest, NextResponse } from "next/server";
import { parseFrontmatter, appendRunToIndex } from "@/lib/db";
import type { TaskStage, RunIndexEntry } from "@/lib/db-adapter.interface";
import { createDbServerClientWithRequest } from "@/lib/db-server";
import { buildMarkdownWithFrontmatter } from "@/lib/orchestration/frontmatter";
import {
  getTicketType,
  type StageDecision,
} from "@/lib/orchestration/stage-machine";
import { getQueue, QUEUE_NAMES } from "@/lib/queue/boss";
import type { TaskJobData } from "@/lib/orchestrator/processor";
import { LOCAL_USER } from "@/lib/auth-mode";
import { logger } from "@/lib/logger";

// POST /api/queue/complete - Mark current stage complete and advance
export async function POST(request: NextRequest) {
  try {
    const userId = LOCAL_USER.id;
    const db = await createDbServerClientWithRequest(request);

    const body = await request.json();
    const { taskId, log, comment, comments, final_result, decision, explanation } = body;
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const artifactPath = typeof body?.artifact_path === "string" ? body.artifact_path.trim() : "";
    const artifactHost = typeof body?.artifact_host === "string" ? body.artifact_host.trim() : "";
    const artifactKey = typeof body?.artifact_key === "string" ? body.artifact_key.trim() : "";

    const { data: task, error: taskError } = await db
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .eq("user_id", userId)
      .single();
    if (taskError || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const { frontmatter, body: markdownBody } = parseFrontmatter(task.content);
    const currentStage = (frontmatter.stage as TaskStage) || "INTAKE";
    const ticketType = getTicketType(frontmatter, markdownBody);
    const finalResultRaw = typeof final_result === "string" ? final_result.trim() : "";
    const decisionRaw = typeof decision === "string" ? decision.trim() : "";
    const explanationRaw = typeof explanation === "string" ? explanation.trim() : "";
    const missingAggregator = !finalResultRaw || !decisionRaw || !explanationRaw;
    const missingAggregatorMessage = "Aggregator output unavailable; manual action required.";
    const finalResult = missingAggregator ? missingAggregatorMessage : finalResultRaw;
    const outcomeInput = missingAggregator ? "blocked" : decisionRaw;
    const explanationFinal = missingAggregator ? missingAggregatorMessage : explanationRaw;

    const allowedDecisions: StageDecision[] = ["done", "blocked", "not_done", "failed"];
    if (!allowedDecisions.includes(outcomeInput as StageDecision)) {
      return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
    }
    const outcome = outcomeInput as StageDecision;
    const explicitComments = Array.isArray(comments)
      ? comments.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
    const agentComment =
      typeof comment === "string" && comment.trim()
        ? comment
        : typeof log === "string" && log.trim()
          ? log
          : finalResult;

    // Best-effort: append run metadata from the daemon so we can display recent runs
    // without uploading full artifacts to the cloud.
    const runEntryRaw = (body?.run_entry || body?.runEntry) as Partial<RunIndexEntry> | undefined;
    if (runEntryRaw && typeof runEntryRaw === "object") {
      const runId = typeof runEntryRaw.run_id === "string" ? runEntryRaw.run_id.trim() : "";
      if (runId) {
        const runEntry: RunIndexEntry = {
          run_id: runId,
          stage: typeof runEntryRaw.stage === "string" && runEntryRaw.stage.trim() ? runEntryRaw.stage.trim() : currentStage,
          engine: typeof runEntryRaw.engine === "string" && runEntryRaw.engine.trim()
            ? runEntryRaw.engine.trim()
            : typeof (frontmatter as any)?.engine === "string" && String((frontmatter as any).engine).trim()
              ? String((frontmatter as any).engine).trim()
              : task.engine || "unknown",
          model: typeof runEntryRaw.model === "string" && runEntryRaw.model.trim() ? runEntryRaw.model.trim() : undefined,
          status: typeof runEntryRaw.status === "string" && runEntryRaw.status.trim() ? runEntryRaw.status.trim() : "unknown",
          created_at: typeof runEntryRaw.created_at === "string" && runEntryRaw.created_at.trim()
            ? runEntryRaw.created_at.trim()
            : new Date().toISOString(),
          artifact_manifest: Array.isArray(runEntryRaw.artifact_manifest) ? runEntryRaw.artifact_manifest : undefined,
          artifact_path: artifactPath || undefined,
          artifact_host: artifactHost || undefined,
          artifact_key: artifactKey || undefined,
        };

        try {
          await appendRunToIndex(taskId, runEntry);
        } catch (err) {
          console.warn("Failed to append run_index entry:", err);
        }
      }
    }

    // Persist blocked status immediately so pickers do not re-queue this task while
    // waiting for workflow signal handling.
    if (outcome === "blocked") {
      const blockedFrontmatter: Record<string, unknown> = {
        ...frontmatter,
        stage: currentStage,
        status: "blocked",
      };
      const blockedContent = buildMarkdownWithFrontmatter(blockedFrontmatter, markdownBody);
      const { error: persistError } = await db
        .from("tasks")
        .update({
          content: blockedContent,
          stage: currentStage,
          status: "blocked",
          ...(artifactPath ? { artifact_path: artifactPath } : {}),
          ...(artifactHost ? { artifact_host: artifactHost } : {}),
          ...(artifactKey ? { artifact_key: artifactKey } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId)
        .eq("user_id", userId);
      if (persistError) {
        throw persistError;
      }
    } else if (artifactPath || artifactHost || artifactKey) {
      // Best-effort: persist the latest artifact pointer fields for quick inspection.
      try {
        const { error: artifactErr } = await db
          .from("tasks")
          .update({
            ...(artifactPath ? { artifact_path: artifactPath } : {}),
            ...(artifactHost ? { artifact_host: artifactHost } : {}),
            ...(artifactKey ? { artifact_key: artifactKey } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("id", taskId)
          .eq("user_id", userId);
        if (artifactErr) {
          // Ignore older schemas that do not have these columns.
          if ((artifactErr as any)?.code !== "42703") {
            console.warn("Failed to persist artifact pointer fields:", artifactErr);
          }
        }
      } catch (err) {
        // Never fail completion for artifact pointer persistence.
        console.warn("Failed to persist artifact pointer fields:", err);
      }
    }

    // Enqueue agent result signal with QueueAdapter
    const queue = await getQueue();
    await queue.send(QUEUE_NAMES.TASK_PROCESS, {
      taskId,
      userId,
      signal: "agentResult",
      payload: {
        decision: outcome,
        explanation: explanationFinal,
        final_result: finalResult,
        comments: explicitComments.length > 0 ? explicitComments : undefined,
        comment: agentComment,
      },
    });

    return NextResponse.json({
      taskId,
      stage: currentStage,
      decision: outcome,
      signaled: true,
    });
  } catch (error) {
    logger.error("Error completing stage", logger.formatError(error));
    return NextResponse.json(
      { error: "Failed to complete stage" },
      { status: 500 }
    );
  }
}
