import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-instance";
import { buildProjectUpdatePayload } from "../payload";
import { LOCAL_USER } from "@/lib/auth-mode";

type ParamsArg = Promise<{ id: string }>;

async function resolveParams(params: ParamsArg) {
  const resolved = await Promise.resolve(params);
  if (!resolved || typeof resolved.id !== "string") return null;
  const trimmed = resolved.id.trim();
  return trimmed || null;
}

async function getRequestUser(_request: NextRequest) {
  return { db: null, user: { id: LOCAL_USER.id }, error: null };
}

export async function GET(request: NextRequest, { params }: { params: ParamsArg }) {
  try {
    const { user, error } = await getRequestUser(request);
    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = await resolveParams(params);
    if (!projectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const project = await db.getProjectWithRepos(projectId, user.id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({ project });
  } catch (err) {
    console.error("Error fetching project:", err);
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: ParamsArg }) {
  try {
    const { user, error } = await getRequestUser(request);
    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = await resolveParams(params);
    if (!projectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 400 });
    }

    const rawBody = await request.json();
    if (!rawBody || typeof rawBody !== "object") {
      return NextResponse.json({ error: "Invalid project payload" }, { status: 400 });
    }

    const updates = buildProjectUpdatePayload(rawBody as Record<string, unknown>);
    if (!Object.keys(updates).length) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const project = await db.updateProject(projectId, user.id, updates);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({ project });
  } catch (err) {
    console.error("Error updating project:", err);
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: ParamsArg }) {
  try {
    const { user, error } = await getRequestUser(request);
    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = await resolveParams(params);
    if (!projectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    await db.deleteProject(projectId, user.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error deleting project:", err);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}

