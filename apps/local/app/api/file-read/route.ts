import { NextRequest } from "next/server";
import { readFile, stat } from "fs/promises";
import { resolve } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Maximum file size we'll read into context (1 MB) */
const MAX_FILE_SIZE = 1024 * 1024;

/**
 * POST /api/file-read
 *
 * Body: { paths: string[] }
 *
 * Returns: { results: Array<{ path, content, error? }> }
 */
export async function POST(request: NextRequest) {
  let body: { paths?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const paths = body?.paths;
  if (!Array.isArray(paths) || paths.length === 0) {
    return Response.json({ error: "paths must be a non-empty array" }, { status: 400 });
  }

  if (paths.some((p) => typeof p !== "string")) {
    return Response.json({ error: "all paths must be strings" }, { status: 400 });
  }

  const results = await Promise.all(
    (paths as string[]).map(async (rawPath) => {
      try {
        const absPath = resolve(rawPath.replace(/^~/, process.env.HOME ?? "~"));

        const fileStat = await stat(absPath);

        if (fileStat.isDirectory()) {
          return { path: rawPath, content: null, error: "Path is a directory, not a file" };
        }

        if (fileStat.size > MAX_FILE_SIZE) {
          return {
            path: rawPath,
            content: null,
            error: `File too large (${(fileStat.size / 1024).toFixed(0)} KB > 1 MB limit)`,
          };
        }

        const content = await readFile(absPath, "utf-8");
        return { path: rawPath, content };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to read file";
        return { path: rawPath, content: null, error: message };
      }
    })
  );

  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
