import { NextRequest, NextResponse } from "next/server";
import { getMessageThread } from "@/lib/history-store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await getMessageThread(id);
  if (!result) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
