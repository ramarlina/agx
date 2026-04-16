import { NextRequest, NextResponse } from "next/server";
import { listTrackerConnections, addTrackerConnection, removeTrackerConnection } from "@/lib/tracker/connections";
import { getAdapterOrNull } from "@/lib/tracker/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const connections = listTrackerConnections(projectId);

  // Enrich with live status
  const enriched = await Promise.all(
    connections.map(async (conn) => {
      const adapter = getAdapterOrNull(conn.type);
      if (!adapter) return { ...conn, connected: false };
      try {
        const status = await adapter.getStatus(projectId);
        return { ...conn, connected: status.connected, user: status.user };
      } catch {
        return { ...conn, connected: false };
      }
    })
  );

  return NextResponse.json({ connections: enriched });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    type?: string;
  };

  const projectId = body.projectId?.trim();
  const type = body.type?.trim();

  if (!projectId || !type) {
    return NextResponse.json({ error: "projectId and type required" }, { status: 400 });
  }

  const adapter = getAdapterOrNull(type);
  if (!adapter) {
    return NextResponse.json({ error: `Unknown tracker type: ${type}` }, { status: 400 });
  }

  addTrackerConnection(projectId, {
    type,
    connectedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true, type });
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    type?: string;
  };

  const projectId = body.projectId?.trim();
  const type = body.type?.trim();

  if (!projectId || !type) {
    return NextResponse.json({ error: "projectId and type required" }, { status: 400 });
  }

  removeTrackerConnection(projectId, type);
  return NextResponse.json({ ok: true });
}