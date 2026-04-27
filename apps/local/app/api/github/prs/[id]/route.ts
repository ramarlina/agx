// apps/local/app/api/github/prs/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchPrViaGh } from "@/lib/gh-pr-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);

  try {
    const result = await fetchPrViaGh(id);
    if (!result) {
      return NextResponse.json({ error: "PR not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `gh CLI failed: ${message}` },
      { status: 502 },
    );
  }
}
