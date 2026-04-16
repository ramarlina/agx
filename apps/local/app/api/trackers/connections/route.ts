import { NextRequest, NextResponse } from "next/server";
import { listTrackerConnections, addTrackerConnection, removeTrackerConnection } from "@/lib/tracker/connections";
import { getAdapterOrNull, listAdapters } from "@/lib/tracker/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const connections = listTrackerConnections(projectId);
  const registeredTypes = new Set(connections.map((c) => c.type));

  // Auto-register any adapter that has a valid token but no registry entry (migration path)
  const allAdapters = listAdapters();
  await Promise.all(
    allAdapters
      .filter((adapter) => !registeredTypes.has(adapter.type))
      .map(async (adapter) => {
        try {
          const status = await adapter.getStatus(projectId);
          if (status.connected) {
            addTrackerConnection(projectId, {
              type: adapter.type,
              connectedAt: new Date().toISOString(),
            });
            connections.push({ type: adapter.type, connectedAt: new Date().toISOString() });
          }
        } catch {
          // ignore — token absent or invalid
        }
      })
  );

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