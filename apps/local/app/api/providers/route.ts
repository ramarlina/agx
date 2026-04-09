import { NextResponse } from "next/server";
import { PROVIDER_CLIS } from "@/lib/provider-clis";
import { commandExists, runShellCheck } from "@/lib/shell-env";

export const dynamic = "force-dynamic";

// GET /api/providers
// Returns all providers with installed and authenticated booleans.
export async function GET() {
  const providers = PROVIDER_CLIS.map((p) => {
    const installed = commandExists(p.bin);
    const authenticated =
      installed && p.authCheck
        ? runShellCheck(p.authCheck.cmd, p.authCheck.timeout)
        : false;
    return { id: p.id, label: p.label, installed, authenticated };
  });

  return NextResponse.json({
    providers,
    supportedProviders: PROVIDER_CLIS.map((p) => ({ id: p.id, label: p.label })),
  });
}
