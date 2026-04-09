import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { LOCAL_USER } from "@/lib/auth-mode";
import type { Task } from "@/lib/db-adapter.interface";
import { db } from "@/lib/db-instance";

export type GraphMutationAction =
  | "create"
  | "update"
  | "replan"
  | "rollback"
  | "start"
  | "stop"
  | "pause"
  | "resume"
  | "restart"
  | "verify_gate"
  | "fail_gate"
  | "node_start"
  | "node_stop"
  | "node_resume"
  | "node_complete"
  | "node_fail"
  | "node_verify";

interface AuthorizeInput {
  request: NextRequest;
  taskId: string;
  action: GraphMutationAction;
  requestedProjectId?: string | null;
}

interface AuthorizeResultOk {
  ok: true;
  response: never;
  actor: { actorId: string; actorType: "user" | "service" };
  task: Task;
  projectId: string | null;
}

interface AuthorizeResultFail {
  ok: false;
  response: NextResponse;
}

type AuthorizeResult = AuthorizeResultOk | AuthorizeResultFail;

/**
 * Simplified authorization that always succeeds with LOCAL_USER.
 * Auth has been removed; this just loads the task and returns the actor context.
 */
export async function authorizeGraphMutation(
  input: AuthorizeInput,
): Promise<AuthorizeResult> {
  const userId = LOCAL_USER.id;
  const task = await db.getTask(input.taskId, userId);

  if (!task) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Task not found" }, { status: 404 }),
    } as AuthorizeResultFail;
  }

  return {
    ok: true,
    actor: { actorId: userId, actorType: "service" },
    task,
    projectId: input.requestedProjectId ?? task.project_id ?? null,
  } as AuthorizeResultOk;
}
