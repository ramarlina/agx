import { NextResponse } from "next/server";
import { isValidOrigin, validateBearerToken } from "@/lib/security";

// `/api/daemon` is privileged host control, not generic local-user auth.
export type DaemonCaller =
  | { kind: "board" }
  | { kind: "service"; userId: string };

function getBrowserOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (origin) {
    return origin;
  }

  // Same-origin GET requests may omit Origin, so fall back to Referer.
  const referer = request.headers.get("referer");
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export async function requireDaemonControl(
  request: Request,
): Promise<
  | { ok: true; caller: DaemonCaller }
  | { ok: false; response: NextResponse }
> {
  const bearer = await validateBearerToken(request.headers.get("authorization"));
  if (bearer.valid && bearer.userId) {
    return {
      ok: true,
      caller: { kind: "service", userId: bearer.userId },
    };
  }

  const browserOrigin = getBrowserOrigin(request);
  if (browserOrigin) {
    if (!isValidOrigin(browserOrigin)) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      };
    }

    return { ok: true, caller: { kind: "board" } };
  }

  return {
    ok: false,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };
}
