import { NextRequest } from "next/server";
import { loadTaskDrafts, saveTaskDraft } from "@/lib/history-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const threadId = request.nextUrl.searchParams.get("threadId")?.trim();
  if (!threadId) {
    return Response.json({ error: "threadId is required" }, { status: 400 });
  }
  const drafts = await loadTaskDrafts(threadId);
  return Response.json({ drafts });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { threadId, messageId, draft } = body;
  if (!threadId || !messageId || !draft) {
    return Response.json({ error: "threadId, messageId, and draft are required" }, { status: 400 });
  }
  await saveTaskDraft(threadId, messageId, draft);
  return Response.json({ ok: true });
}
