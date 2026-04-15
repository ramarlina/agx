import { NextRequest, NextResponse } from "next/server";
import { getLinearClient, deleteProjectTicketToken } from "@/lib/linear-client";
import { commandExists } from "@/lib/shell-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireProjectId(req: NextRequest): string | null {
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  return projectId || null;
}

export async function GET(req: NextRequest) {
  const projectId = requireProjectId(req);
  let connected = false;
  let user: { name: string; email: string } | null = null;

  if (projectId) {
    const client = getLinearClient(projectId);
    if (client) {
      try {
        const viewer = await client.viewer;
        connected = true;
        user = { name: viewer.name, email: viewer.email };
      } catch {
        connected = false;
      }
    }
  }

  return NextResponse.json({
    provider: "linear",
    connected,
    user,
    clis: {
      claude: commandExists("claude"),
      codex: commandExists("codex"),
      gemini: commandExists("gemini"),
    },
  });
}

export async function DELETE(req: NextRequest) {
  const projectId = requireProjectId(req);
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  deleteProjectTicketToken(projectId, "linear");
  return NextResponse.json({ disconnected: true });
}
