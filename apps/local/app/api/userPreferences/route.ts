import { NextRequest } from "next/server";
import { loadUserPreferences, saveUserPreferences } from "@/lib/userPreferences";
import { sanitizePartialUserPreferences } from "@/types/userPreferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readPreferencesBody(body: unknown): unknown {
  if (!body || typeof body !== "object") {
    return body;
  }

  const candidate = body as Record<string, unknown>;
  return candidate.preferences ?? body;
}

export async function GET() {
  return Response.json({ preferences: loadUserPreferences() });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.json().catch((err) => { console.error('[userPreferences] body parse failed:', err); return null; });
  const payload = sanitizePartialUserPreferences(readPreferencesBody(rawBody));

  if (Object.keys(payload).length === 0) {
    return Response.json(
      { error: "No valid preferences provided", preferences: loadUserPreferences() },
      { status: 400 }
    );
  }

  const preferences = saveUserPreferences(payload);
  return Response.json({ preferences });
}
