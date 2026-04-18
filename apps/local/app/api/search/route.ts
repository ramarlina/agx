import { NextRequest } from "next/server";
import { searchMessages } from "@/lib/history-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return Response.json({ error: "q is required" }, { status: 400 });
  }

  const threadId =
    request.nextUrl.searchParams.get("thread_id")?.trim() ||
    request.nextUrl.searchParams.get("threadId")?.trim() ||
    undefined;
  const limit = parsePositiveInt(request.nextUrl.searchParams.get("limit"), 20);
  const offset = parsePositiveInt(request.nextUrl.searchParams.get("offset"), 0);

  try {
    const { results, total } = await searchMessages({
      query,
      threadId,
      limit,
      offset,
    });
    return Response.json({
      results,
      total,
      query,
    });
  } catch (error) {
    if (error instanceof Error && /fts5|MATCH|syntax/i.test(error.message)) {
      return Response.json({ error: "Invalid search query syntax" }, { status: 400 });
    }
    logger.error("Search failed", logger.formatError(error));
    return Response.json({ error: "Search failed" }, { status: 500 });
  }
}
