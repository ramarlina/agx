import { NextResponse } from "next/server";
import { PROVIDER_CLIS } from "@/lib/provider-clis";
import { commandExists, runShellCheck } from "@/lib/shell-env";

export const dynamic = "force-dynamic";

// GET /api/providers/check/:id
// Single-provider auth check for frontend polling.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const provider = PROVIDER_CLIS.find((p) => p.id === id);
  if (!provider) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  const installed = commandExists(provider.bin);
  const authenticated =
    installed && provider.authCheck
      ? runShellCheck(provider.authCheck.cmd, provider.authCheck.timeout)
      : false;

  return NextResponse.json({ id: provider.id, installed, authenticated });
}
