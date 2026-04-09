import { NextResponse } from "next/server";
import { getLinearClient, deleteLinearToken } from "@/lib/linear-client";
import { commandExists } from "@/lib/shell-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const client = getLinearClient();
  let connected = false;
  let user: { name: string; email: string } | null = null;

  if (client) {
    try {
      const viewer = await client.viewer;
      connected = true;
      user = { name: viewer.name, email: viewer.email };
    } catch {
      // Token expired or invalid
      connected = false;
    }
  }

  return NextResponse.json({
    connected,
    user,
    clis: {
      claude: commandExists("claude"),
      codex: commandExists("codex"),
      gemini: commandExists("gemini"),
    },
  });
}

export async function DELETE() {
  deleteLinearToken();
  return NextResponse.json({ disconnected: true });
}
