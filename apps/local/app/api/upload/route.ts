import { NextRequest } from "next/server";
import { createAttachment, gcOrphanedAttachments } from "@/lib/attachment-store";
import { validateFile, validateMessageAttachments, sanitizeFilename } from "@/lib/attachments";
import crypto from "crypto";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Run GC on first upload request
let gcRan = false;

export async function POST(request: NextRequest) {
  if (!gcRan) {
    gcRan = true;
    gcOrphanedAttachments().catch((err) => logger.error('[upload] gcOrphanedAttachments failed', logger.formatError(err)));
  }

  const formData = await request.formData().catch((err) => { logger.error('[upload] formData parse failed', logger.formatError(err)); return null; });
  if (!formData) {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const files: File[] = [];
  for (const [, value] of formData.entries()) {
    if (value instanceof File) files.push(value);
  }

  if (files.length === 0) {
    return Response.json({ error: "No files provided" }, { status: 400 });
  }

  // Validate all files
  const fileMetas = files.map((f) => ({ name: f.name, size: f.size, type: f.type }));
  const totalError = validateMessageAttachments(fileMetas);
  if (totalError) {
    return Response.json({ error: totalError.reason }, { status: 400 });
  }

  const results = [];
  const errors = [];

  for (const file of files) {
    const validationError = validateFile({ name: file.name, size: file.size, type: file.type });
    if (validationError) {
      errors.push(validationError);
      continue;
    }

    const id = crypto.randomUUID();
    const buffer = Buffer.from(await file.arrayBuffer());
    const attachment = await createAttachment({
      id,
      filename: sanitizeFilename(file.name),
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      data: buffer,
    });
    results.push(attachment);
  }

  if (errors.length > 0 && results.length === 0) {
    return Response.json({ error: errors[0].reason, errors }, { status: 400 });
  }

  return Response.json({ attachments: results, errors });
}
