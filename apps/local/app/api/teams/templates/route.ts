import { NextResponse } from "next/server";
import { listTeamTemplates } from "@/lib/team-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/teams/templates — list available team templates from the catalog */
export async function GET() {
  const templates = listTeamTemplates();
  return NextResponse.json({ templates });
}
