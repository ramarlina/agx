import { NextRequest } from "next/server";
import { deleteAttachment } from "@/lib/attachment-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const deleted = await deleteAttachment(id);
  if (!deleted) {
    return Response.json({ error: "Attachment not found" }, { status: 404 });
  }

  return Response.json({ ok: true });
}
