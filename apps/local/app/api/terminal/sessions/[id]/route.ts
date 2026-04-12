import { NextRequest } from "next/server";
import { destroySession } from "@/lib/pty-manager";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const deleted = destroySession(decodeURIComponent(id));
  return Response.json({ deleted });
}
