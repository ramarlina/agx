import { NextRequest, NextResponse } from "next/server";
import { getProjectVariables } from "@/lib/db";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; key: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId, key } = await context.params;
    const variables = await getProjectVariables(projectId);
    const variable = variables.find((v) => v.key === key);
    if (!variable) {
      return NextResponse.json({ error: "Variable not found" }, { status: 404 });
    }
    return NextResponse.json({ key: variable.key, value: variable.value });
  } catch (error) {
    logger.error("Error fetching variable", logger.formatError(error));
    return NextResponse.json({ error: "Failed to fetch variable" }, { status: 500 });
  }
}
