import { NextResponse } from "next/server";
import { getChatRun, listChatRunSteps } from "@/lib/history-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await getChatRun(id);
  if (!run) {
    return NextResponse.json({ error: "Chat run not found" }, { status: 404 });
  }

  const steps = await listChatRunSteps(id);
  return NextResponse.json({ ...run, steps });
}
