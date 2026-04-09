import { NextRequest } from "next/server";
import { getAttachmentMeta } from "@/lib/attachment-store";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const meta = await getAttachmentMeta(id);
  if (!meta) {
    return Response.json({ error: "Attachment not found" }, { status: 404 });
  }

  const filePath = meta.diskPath;
  try {
    await stat(filePath);
  } catch {
    return Response.json({ error: "File not found on disk" }, { status: 404 });
  }

  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new Response(webStream, {
    headers: {
      "Content-Type": meta.mimeType,
      "Content-Length": String(meta.size),
      "Content-Disposition": `inline; filename="${meta.filename}"`,
      "Cache-Control": "private, max-age=86400",
    },
  });
}
