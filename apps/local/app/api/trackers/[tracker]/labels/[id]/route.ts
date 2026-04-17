import { NextRequest, NextResponse } from "next/server";
import { deleteLabelDefinition } from "@/lib/tracker/tracker-item-metadata-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ tracker: string; id: string }> }
) {
  const { id } = await params;
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  try {
    await deleteLabelDefinition(projectId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete label";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
