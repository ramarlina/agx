import { NextRequest } from "next/server";
import { createAdminDbClient } from "@/lib/db-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SSE endpoint for real-time task updates
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection message
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "connected", timestamp: Date.now() })}\n\n`)
      );

      const db = createAdminDbClient();
      let lastTaskAt = new Date(Date.now() - 5000).toISOString();
      let lastLogAt = new Date(Date.now() - 5000).toISOString();

      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "subscribed", timestamp: Date.now() })}\n\n`)
      );

      const poll = setInterval(async () => {
        try {
          const { data: tasks } = await db
            .from("tasks")
            .select("*")
            .gt("updated_at", lastTaskAt)
            .order("updated_at", { ascending: true })
            .limit(100);

          for (const task of tasks || []) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "UPDATE", task, timestamp: Date.now() })}\n\n`)
            );
            if (task.updated_at && task.updated_at > lastTaskAt) lastTaskAt = task.updated_at;
          }

          const { data: logs } = await db
            .from("task_logs")
            .select("*")
            .gt("created_at", lastLogAt)
            .order("created_at", { ascending: true })
            .limit(200);

          for (const log of logs || []) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "log", log, timestamp: Date.now() })}\n\n`)
            );
            if (log.created_at && log.created_at > lastLogAt) lastLogAt = log.created_at;
          }
        } catch {
          // Ignore polling failures and continue.
        }
      }, 2000);

      // Send heartbeat every 30 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "heartbeat", timestamp: Date.now() })}\n\n`)
          );
        } catch {
          // Stream closed
          clearInterval(heartbeat);
        }
      }, 30000);

      // Handle client disconnect
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
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}
