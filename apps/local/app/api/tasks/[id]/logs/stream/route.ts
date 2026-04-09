import { NextRequest } from "next/server";
import { createAdminDbClient } from "@/lib/db-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await params;
  if (!taskId) {
    return new Response(
      JSON.stringify({ error: "taskId parameter is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "connected", taskId, timestamp: Date.now() })}\n\n`
        )
      );

      const db = createAdminDbClient();
      let lastLogAt = new Date(Date.now() - 5000).toISOString();
      let lastTaskAt = new Date(Date.now() - 5000).toISOString();

      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "subscribed", taskId, timestamp: Date.now() })}\n\n`
        )
      );

      const poll = setInterval(async () => {
        try {
          const { data: logs } = await db
            .from("task_logs")
            .select("*")
            .eq("task_id", taskId)
            .gt("created_at", lastLogAt)
            .order("created_at", { ascending: true })
            .limit(200);

          for (const log of logs || []) {
            const message = { type: "log", log, timestamp: Date.now() };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
            if (log.created_at && log.created_at > lastLogAt) {
              lastLogAt = log.created_at;
            }
          }

          const { data: tasks } = await db
            .from("tasks")
            .select("*")
            .eq("id", taskId)
            .gt("updated_at", lastTaskAt)
            .order("updated_at", { ascending: true })
            .limit(1);

          for (const task of tasks || []) {
            const message = { type: "task_update", task, timestamp: Date.now() };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
            if (task.updated_at && task.updated_at > lastTaskAt) {
              lastTaskAt = task.updated_at;
            }
          }
        } catch {
          // Ignore polling failures and keep streaming
        }
      }, 2000);

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "heartbeat", timestamp: Date.now() })}\n\n`
            )
          );
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      request.signal.addEventListener("abort", () => {
        clearInterval(poll);
        clearInterval(heartbeat);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
