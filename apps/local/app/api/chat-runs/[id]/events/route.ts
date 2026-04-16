import { NextRequest } from "next/server";
import { getChatEventBus } from "@/lib/chat-event-bus";
import { loadChatRunActivity } from "@/lib/orchestrator/chat-activities";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: chatRunId } = await params;

  const chatRun = await loadChatRunActivity(chatRunId);
  if (!chatRun) {
    return new Response("Chat run not found", { status: 404 });
  }

  const eventBus = getChatEventBus();
  const isComplete = eventBus.isComplete(chatRunId) ||
    chatRun.status === "completed" ||
    chatRun.status === "failed" ||
    chatRun.status === "cancelled";

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream closed
        }
      };

      // Heartbeat to keep the connection alive
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      if (isComplete) {
        // Replay buffered events and close
        const unsubscribe = eventBus.subscribe(chatRunId, (event) => {
          send("chat", event);
        });
        unsubscribe();
        send("chat", { type: "done" });
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
        closed = true;
        return;
      }

      // Subscribe for live events
      const unsubscribe = eventBus.subscribe(chatRunId, (event) => {
        if (event.type === "done") {
          send("chat", event);
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
          try { controller.close(); } catch { /* already closed */ }
          return;
        }
        send("chat", event);
      });

      // Clean up on client disconnect
      setTimeout(() => {
        if (!closed) {
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
          try { controller.close(); } catch { /* already closed */ }
        }
      }, 30 * 60 * 1000); // 30 min max connection time
    },

    cancel() {
      closed = true;
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