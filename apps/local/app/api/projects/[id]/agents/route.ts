import { NextRequest, NextResponse } from "next/server";
import {
  getProjectAgents,
  addProjectAgent,
  removeProjectAgent,
  reorderProjectAgents,
} from "@/lib/db";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/projects/[id]/agents — list agents in a project with routing order */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const agents = await getProjectAgents(projectId);
    return NextResponse.json({ agents });
  } catch (error) {
    logger.error("Error fetching project agents", logger.formatError(error));
    return NextResponse.json({ error: "Failed to fetch project agents" }, { status: 500 });
  }
}

/** POST /api/projects/[id]/agents — add an agent to the project */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";

    if (!agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }

    await addProjectAgent(projectId, agentId, body.routingOrder);
    const agents = await getProjectAgents(projectId);
    return NextResponse.json({ agents }, { status: 201 });
  } catch (error) {
    logger.error("Error adding agent to project", logger.formatError(error));
    return NextResponse.json({ error: "Failed to add agent to project" }, { status: 500 });
  }
}

/** DELETE /api/projects/[id]/agents?agentId=<id> — remove an agent from the project */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const agentId = new URL(request.url).searchParams.get("agentId");

    if (!agentId) {
      return NextResponse.json({ error: "agentId query param is required" }, { status: 400 });
    }

    await removeProjectAgent(projectId, agentId);
    const agents = await getProjectAgents(projectId);
    return NextResponse.json({ agents });
  } catch (error) {
    logger.error("Error removing agent from project", logger.formatError(error));
    return NextResponse.json({ error: "Failed to remove agent from project" }, { status: 500 });
  }
}

/** PATCH /api/projects/[id]/agents — reorder agents (expects { orderedAgentIds: string[] }) */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const orderedIds = body.orderedAgentIds;

    if (!Array.isArray(orderedIds) || orderedIds.some((id: unknown) => typeof id !== "string")) {
      return NextResponse.json({ error: "orderedAgentIds must be a string array" }, { status: 400 });
    }

    const agents = await reorderProjectAgents(projectId, orderedIds);
    return NextResponse.json({ agents });
  } catch (error) {
    logger.error("Error reordering project agents", logger.formatError(error));
    return NextResponse.json({ error: "Failed to reorder agents" }, { status: 500 });
  }
}
