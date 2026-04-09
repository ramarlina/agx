import { LOCAL_USER } from "@/lib/auth-mode";

export type RequestAuthResult = { ok: true; userId: string };

export async function requireUserId(_request?: unknown): Promise<RequestAuthResult> {
  return { ok: true, userId: LOCAL_USER.id };
}
