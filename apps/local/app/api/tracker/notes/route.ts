import { NextRequest } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizePathSegment(value: string): string {
  const sanitized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-");
  return sanitized || "untitled";
}

function notePath(projectSlug: string, type: "issue" | "group", id: string): string {
  const home = process.env.HOME ?? "~";
  const folder = type === "issue" ? "issues" : "groups";
  return join(
    home,
    ".agx",
    "projects",
    sanitizePathSegment(projectSlug),
    folder,
    sanitizePathSegment(id),
    "note.md"
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const projectSlug = searchParams.get("projectSlug");
  const id = searchParams.get("id");
  const type = searchParams.get("type") as "issue" | "group" | null;

  if (!projectSlug || !id || (type !== "issue" && type !== "group")) {
    return Response.json({ error: "Missing required params: projectSlug, id, type" }, { status: 400 });
  }

  try {
    const content = await readFile(notePath(projectSlug, type, id), "utf-8");
    return Response.json({ content });
  } catch {
    return Response.json({ content: null });
  }
}

export async function POST(request: NextRequest) {
  let body: { projectSlug?: unknown; id?: unknown; type?: unknown; content?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectSlug, id, type, content } = body;
  if (
    typeof projectSlug !== "string" ||
    typeof id !== "string" ||
    (type !== "issue" && type !== "group") ||
    typeof content !== "string"
  ) {
    return Response.json({ error: "Missing or invalid fields" }, { status: 400 });
  }

  const filePath = notePath(projectSlug, type as "issue" | "group", id);
  await mkdir(dirname(filePath), { recursive: true });

  if (content.trim() === "") {
    try {
      const { unlink } = await import("fs/promises");
      await unlink(filePath);
    } catch {
      // Already gone, fine
    }
    return Response.json({ ok: true });
  }

  await writeFile(filePath, content, "utf-8");
  return Response.json({ ok: true });
}
