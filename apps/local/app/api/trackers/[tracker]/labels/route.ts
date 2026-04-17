import { NextRequest, NextResponse } from "next/server";
import {
  listAllLabels,
  listLabelDefinitions,
  createLabelDefinition,
} from "@/lib/tracker/tracker-item-metadata-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const [allLabels, definitions] = await Promise.all([
    listAllLabels(projectId),
    listLabelDefinitions(projectId),
  ]);
  return NextResponse.json({ labels: allLabels, definitions });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      projectId?: string;
      name?: string;
      color?: string;
    };
    const projectId = body.projectId?.trim();
    const name = body.name?.trim();
    if (!projectId || !name) {
      return NextResponse.json({ error: "projectId and name required" }, { status: 400 });
    }
    const definition = await createLabelDefinition(projectId, name, body.color);
    return NextResponse.json(definition, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create label";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
