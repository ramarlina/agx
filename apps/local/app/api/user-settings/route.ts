import { NextRequest, NextResponse } from "next/server";
import { LOCAL_USER } from "@/lib/auth-mode";
import { db } from "@/lib/db-instance";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeProvider(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

function normalizeModels(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof k !== "string") continue;
    if (typeof v !== "string") continue;
    const kk = k.trim();
    const vv = v.trim();
    if (!kk || !vv) continue;
    out[kk] = vv;
  }
  return out;
}

// GET /api/user-settings
export async function GET(_request: NextRequest) {
  try {
    const userId = LOCAL_USER.id;
    const settings = await db.getUserSettings(userId);
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("Error fetching user settings:", error);
    const e: any = error;
    const code = typeof e?.code === "string" ? e.code : "";
    const msg = typeof e?.message === "string" ? e.message : "";
    if (code === "42P01" || code === "PGRST205" || msg.includes("user_settings")) {
      return NextResponse.json(
        { error: "User settings schema is not available. Run Db migrations to create agx.user_settings.", code: "SCHEMA_NOT_READY" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Failed to fetch user settings" }, { status: 500 });
  }
}

// PUT /api/user-settings
// Body:
// - default_provider?: string | null
// - default_model?: string | null
// - models?: Record<string, string>
// - provenance?: "cli" | "web"
// - changed_at?: ISO string (only used by cli sync)
export async function PUT(request: NextRequest) {
  try {
    const userId = LOCAL_USER.id;
    const body = await request.json().catch((err) => { console.error('[user-settings] body parse failed:', err); return null; });
    if (!isRecord(body)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const defaultProvider = normalizeProvider(body.default_provider);
    const defaultModel = normalizeProvider(body.default_model);
    const modelsIn = normalizeModels(body.models);

    const provenanceRaw = body.provenance;
    const provenance = provenanceRaw === "cli" ? "cli" : "web";
    const changedAt = typeof body.changed_at === "string" ? body.changed_at : null;

    const models: Record<string, string> = modelsIn || {};
    if (defaultProvider && defaultModel) {
      models[defaultProvider] = defaultModel;
    }

    const { settings, updated } = await db.upsertUserSettings(
      userId,
      {
        default_provider: defaultProvider,
        models,
        provenance,
        changed_at: changedAt,
      },
      { onlyIfNewer: true }
    );

    return NextResponse.json({ settings, updated });
  } catch (error) {
    console.error("Error saving user settings:", error);
    const e: any = error;
    const code = typeof e?.code === "string" ? e.code : "";
    const msg = typeof e?.message === "string" ? e.message : "";
    if (code === "42P01" || code === "PGRST205" || msg.includes("user_settings")) {
      return NextResponse.json(
        { error: "User settings schema is not available. Run Db migrations to create agx.user_settings.", code: "SCHEMA_NOT_READY" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Failed to save user settings" }, { status: 500 });
  }
}
