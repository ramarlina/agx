import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGX_API_URL = process.env.AGX_API_URL || "http://localhost:8080";

/** GET /api/agent-specs/pull?code=XXXXXX — pull agent spec from agx-api */
export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    if (!code) {
      return Response.json({ error: "code required" }, { status: 400 });
    }

    const res = await fetch(`${AGX_API_URL}/api/v1/agent/specs/pull?code=${encodeURIComponent(code)}`);

    if (!res.ok) {
      if (res.status === 404) {
        return Response.json({ error: "Code not found or expired" }, { status: 404 });
      }
      const err = await res.text();
      return Response.json({ error: `agx-api error: ${err}` }, { status: res.status });
    }

    const data = await res.json();
    // data.payload is the AgentBundle JSON string — parse it
    const bundle = typeof data.payload === "string" ? JSON.parse(data.payload) : data.payload;
    return Response.json({
      bundle,
      expires_at: data.expires_at,
      created_at: data.created_at,
    });
  } catch (error) {
    console.error("Error pulling agent spec:", error);
    return Response.json({ error: "Failed to pull" }, { status: 500 });
  }
}
