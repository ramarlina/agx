import { NextRequest, NextResponse } from "next/server";
import { getItemMetadata, setItemMetadata } from "@/lib/tracker/tracker-item-metadata-store";
import { parseBody } from "@/lib/parse-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  const issueId = req.nextUrl.searchParams.get("issueId")?.trim();
  if (!projectId || !issueId) {
    return NextResponse.json({ error: "projectId and issueId required" }, { status: 400 });
  }
  const metadata = await getItemMetadata(projectId, issueId);
  return NextResponse.json(metadata);
}

export async function PATCH(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  const issueId = req.nextUrl.searchParams.get("issueId")?.trim();
  if (!projectId || !issueId) {
    return NextResponse.json({ error: "projectId and issueId required" }, { status: 400 });
  }
  try {
    const parsed = await parseBody<{ labels?: string[]; estimate?: number | null }>(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const metadata = await setItemMetadata(projectId, issueId, body);
    return NextResponse.json(metadata);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update metadata";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
