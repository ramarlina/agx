import { NextResponse } from "next/server";
import { LOCAL_USER } from "@/lib/auth-mode";
import { db } from "@/lib/db-instance";

export async function GET() {
  try {
    const dbHealth = await db.healthCheck();
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      user: LOCAL_USER.id,
      ...dbHealth,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Health check failed";
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        adapter: "unknown",
        connected: false,
        latencyMs: -1,
        error: message,
      },
      { status: 503 },
    );
  }
}
