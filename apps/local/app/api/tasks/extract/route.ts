import { NextResponse } from "next/server";
import { loadHistory } from "@/lib/history-store";
import { filterActiveParticipants, loadDbParticipants } from "@/lib/agent-participants";
import { runCliResponse } from "@/lib/cli-runner";

export async function POST(req: Request) {
  try {
    const { threadId, rootMessageId, activeParticipantIds } = await req.json();
    if (!threadId || !rootMessageId) {
      return NextResponse.json(
        { error: "threadId and rootMessageId are required" },
        { status: 400 }
      );
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
        const name =
          m.role === "user"
            ? "User"
            : m.participantId
              ? pMap[m.participantId]?.name || m.participantId
              : "Assistant";
        return `${name}: ${m.content}`;
      })
      .join("\n\n");

    const prompt = `Read the following conversation and extract a list of actionable tasks that were discussed. Order them by execution sequence — tasks that others depend on should come first.

For each task, provide:
- "title": a concise title (under 80 characters)
- "description": a detailed description including all relevant context, requirements, constraints, and acceptance criteria discussed in the thread
- "depends_on": an array of zero-based indices of other tasks in this list that must be completed before this one can start (e.g. [0, 2] means this task depends on tasks at index 0 and 2). Use an empty array [] if the task has no dependencies.

Return ONLY a valid JSON array of objects with "title", "description", and "depends_on" fields. No other text.

---
${formatted}
---`;

    let responseText = "";
    await runCliResponse({
      provider: agent.provider,
      model: agent.model,
      prompt,
      identity: agent.identity,
      onDelta: (chunk) => {
        responseText += chunk;
      },
    });

    responseText = responseText.trim();

    // Extract JSON array from response (handle markdown code blocks)
    let jsonStr = responseText;
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    let tasks: Array<{ title: string; description: string; depends_on?: number[] }>;
    try {
      tasks = JSON.parse(jsonStr);
      if (!Array.isArray(tasks)) throw new Error("Not an array");
    } catch {
      return NextResponse.json(
        { error: "Failed to parse tasks from LLM response", raw: responseText },
        { status: 500 }
      );
    }

    // Validate, assign IDs, and resolve index-based deps to UUIDs
    const valid = tasks.filter((t) => t.title && t.description).slice(0, 20);
    const ids = valid.map(() => crypto.randomUUID());
    const drafts = valid.map((t, i) => ({
      id: ids[i],
      title: t.title.slice(0, 200),
      description: t.description,
      dependsOn: (t.depends_on || [])
        .filter((idx) => idx >= 0 && idx < valid.length && idx !== i)
        .map((idx) => ids[idx]),
    }));

    return NextResponse.json({ ok: true, tasks: drafts });
  } catch (error) {
    console.error("Task extraction error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
