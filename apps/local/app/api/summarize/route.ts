import { NextResponse } from "next/server";
import { loadHistory, saveMessages } from "@/lib/history-store";
import { filterActiveParticipants, loadDbParticipants } from "@/lib/agent-participants";
import { runCliResponse } from "@/lib/cli-runner";
import type { GroupMessage } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const { threadId, rootMessageId, activeParticipantIds } = await req.json();
    if (!threadId || !rootMessageId) {
      return NextResponse.json({ error: "threadId and rootMessageId are required" }, { status: 400 });
    }

    const allMessages = await loadHistory(threadId);
    const rootMsg = allMessages.find((m) => m.id === rootMessageId);
    if (!rootMsg) {
      return NextResponse.json({ error: "Root message not found" }, { status: 404 });
    }

    const replies = allMessages
      .filter((m) => m.rootMessageId === rootMessageId)
      .sort((a, b) => a.timestamp - b.timestamp);

    const threadMessages = [rootMsg, ...replies];

    const participantLibrary = await loadDbParticipants();
    const participants = filterActiveParticipants(participantLibrary, activeParticipantIds);
    const agent = participants[0];
    if (!agent) {
      return NextResponse.json({ error: "No active agents configured for this project" }, { status: 400 });
    }

    const pMap = Object.fromEntries(participantLibrary.map((p) => [p.id, p]));
    const formatted = threadMessages
      .map((m) => {
        const name = m.role === "user" ? "User" : (m.participantId ? pMap[m.participantId]?.name || m.participantId : "Assistant");
        return `${name}: ${m.content}`;
      })
      .join("\n\n");

    const userQuestion = rootMsg.content;
    const prompt = `A user asked: "${userQuestion}"\n\nBelow is the conversation thread with responses from various participants. Synthesize all the responses and provide a concise, direct answer to the user's question. Respond as if you are answering the user yourself. Keep it to 2-4 sentences.\n\n---\n${formatted}\n---`;

    let summaryText = "";
    await runCliResponse({
      provider: agent.provider,
      model: agent.model,
      prompt,
      identity: agent.identity,
      onDelta: (chunk) => { summaryText += chunk; },
    });

    summaryText = summaryText.trim();
    if (!summaryText) {
      return NextResponse.json({ error: "Empty summary generated" }, { status: 500 });
    }

    const summary: GroupMessage = {
      id: `summary-${rootMessageId}`,
      role: "assistant",
      participantId: agent.id,
      content: `<!-- thread-summary -->\n${summaryText}`,
      timestamp: Date.now(),
      rootMessageId,
      parentMessageId: null,
      depth: 1,
    };

    await saveMessages(threadId, [summary]);

    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    console.error("Summarize error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
