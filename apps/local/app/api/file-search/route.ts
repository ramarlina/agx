import { NextRequest } from "next/server";
import { searchFiles, getRootSuggestions, validateSearchRoot } from "@/lib/file-search";
import { DEFAULT_IGNORE_PATTERNS, FileSuggestion } from "@/types/fileMention";
import { getFolderManifest } from "@/lib/fs/folderManifest";

/** Attach lightweight manifests to folder entries. Files are returned as-is. */
async function enrichWithManifests(files: FileSuggestion[]): Promise<FileSuggestion[]> {
  return Promise.all(
    files.map(async (f) => {
      if (f.type !== "folder") return f;
      try {
        const manifest = await getFolderManifest(f.path);
        return { ...f, manifest };
      } catch {
        return f;
      }
    })
  );
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * GET /api/file-search
 *
 * Query params:
 *   q        - path query string (required)
 *   root     - workspace root override (must be within allowed roots)
 *   limit    - max results (default 50)
 *   cursor   - opaque pagination cursor (offset as base64-encoded integer)
 *   requestId - client-provided ID for cancellable queries (echoed back)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const q = searchParams.get("q");
  if (q === null || q.trim() === "") {
    return Response.json(
      { error: "Missing required query parameter: q" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  const root = searchParams.get("root") ?? undefined;
  const requestId = searchParams.get("requestId") ?? undefined;

  const limitParam = searchParams.get("limit");
  const limit = limitParam
    ? Math.min(Math.max(1, parseInt(limitParam, 10) || PAGE_SIZE), 200)
    : PAGE_SIZE;

  // Decode cursor (base64-encoded offset integer)
  const cursorParam = searchParams.get("cursor");
  let offset = 0;
  if (cursorParam) {
    try {
      offset = parseInt(Buffer.from(cursorParam, "base64url").toString("utf8"), 10) || 0;
    } catch {
      // ignore malformed cursor, start from 0
    }
  }

  const ignorePatterns = [...DEFAULT_IGNORE_PATTERNS];

  // Short query: return root-level suggestions instead of a deep search
  if (q.trim().length < 3) {
    try {
      const validatedRoot = await validateSearchRoot(root, [], true);
      const rawSuggestions = await getRootSuggestions(validatedRoot, ignorePatterns);
      const suggestions = await enrichWithManifests(rawSuggestions.slice(0, limit));
      return Response.json(
        {
          files: suggestions,
          hasMore: suggestions.length > limit,
          usedRoot: validatedRoot,
          total: suggestions.length,
          isRootSuggestions: true,
          ...(requestId ? { requestId } : {}),
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Root suggestion failed";
      return Response.json(
        { error: message, ...(requestId ? { requestId } : {}) },
        { status: 403 }
      );
    }
  }

  try {
    const includeFolders = searchParams.get("includeFolders") === "1";
    const result = await searchFiles(
      { query: q.trim(), root, limit: limit + offset, includeFolders },
      [], // allowedRoots
      true, // homeSearchConsent
      ignorePatterns
    );

    // Apply cursor-based pagination and enrich folders with manifests
    const page = await enrichWithManifests(result.files.slice(offset, offset + limit));
    const hasMore = result.files.length > offset + limit;

    // Encode next cursor
    const nextCursor = hasMore
      ? Buffer.from(String(offset + limit), "utf8").toString("base64url")
      : null;

    return Response.json(
      {
        files: page,
        hasMore,
        ...(nextCursor ? { nextCursor } : {}),
        ...(requestId ? { requestId } : {}),
        usedRoot: result.usedRoot,
        total: result.total,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "File search failed";
    const isAuthError =
      message.includes("not within an allowed") ||
      message.includes("No workspace root") ||
      message.includes("does not exist");

    return Response.json(
      { error: message, ...(requestId ? { requestId } : {}) },
      { status: isAuthError ? 403 : 500 }
    );
  }
}
