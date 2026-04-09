import { NextResponse } from "next/server";
import { PROVIDER_CLIS } from "@/lib/provider-clis";
import { commandExists } from "@/lib/shell-env";

// GET /api/providers
// Returns providers available on the machine (derived from installed CLIs).
export async function GET() {
  const available = PROVIDER_CLIS.filter((p) => commandExists(p.bin)).map((p) => ({
    id: p.id,
    label: p.label,
  }));

  return NextResponse.json({
    providers: available,
    supportedProviders: PROVIDER_CLIS.map((provider) => ({
      id: provider.id,
      label: provider.label,
    })),
  });
}
