import { NextRequest } from "next/server";
import {
  loadThreadRepoSelections,
  saveThreadRepoSelections,
} from "@/lib/history-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rootMessageId = request.nextUrl.searchParams.get("rootMessageId")?.trim() ?? "";
  if (!rootMessageId) {
    return Response.json({ error: "rootMessageId is required" }, { status: 400 });
  }
  const repoIds = await loadThreadRepoSelections(rootMessageId);
  return Response.json({ repoIds });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const { rootMessageId, repoIds } = body as { rootMessageId?: string; repoIds?: string[] };
  if (!rootMessageId || !Array.isArray(repoIds)) {
    return Response.json({ error: "rootMessageId and repoIds[] required" }, { status: 400 });
  }
  await saveThreadRepoSelections(rootMessageId, repoIds);
  return Response.json({ ok: true });
}
