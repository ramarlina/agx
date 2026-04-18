import { NextRequest, NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import {
  bulkGetItemMetadata,
  bulkSetEstimate,
  bulkAddLabels,
  bulkRemoveLabel,
} from "@/lib/tracker/tracker-item-metadata-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  const issueIdsParam = req.nextUrl.searchParams.get("issueIds")?.trim();
  if (!projectId || !issueIdsParam) {
    return NextResponse.json({ error: "projectId and issueIds required" }, { status: 400 });
  }
  const issueIds: string[] = (issueIdsParam as string).split(",").map((s: string) => s.trim()).filter((s: string) => s.length > 0);
  const metadata = await bulkGetItemMetadata(projectId, issueIds);
  const result: Record<string, { labels: string[]; estimate: number | null }> = {};
  for (const [id, meta] of metadata.entries()) {
    result[id] = meta;
  }
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseBody<{
      projectId?: string;
      issueIds?: string[];
      action?: string;
      payload?: Record<string, unknown>;
    }>(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const projectId = body.projectId?.trim();
    const issueIds = body.issueIds?.filter((id) => id?.trim()) ?? [];
    const action = body.action?.trim();

    if (!projectId || issueIds.length === 0 || !action) {
      return NextResponse.json({ error: "projectId, issueIds, and action required" }, { status: 400 });
    }

    switch (action) {
      case "set_estimate": {
        const estimate = (body.payload as { estimate?: number | null })?.estimate ?? null;
        await bulkSetEstimate(projectId, issueIds, estimate);
        break;
      }
      case "add_labels": {
        const labels = (body.payload as { labels?: string[] })?.labels ?? [];
        await bulkAddLabels(projectId, issueIds, labels);
        break;
      }
      case "remove_label": {
        const label = (body.payload as { label?: string })?.label ?? "";
        await bulkRemoveLabel(projectId, issueIds, label);
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bulk metadata operation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
