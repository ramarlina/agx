import { NextRequest, NextResponse } from "next/server";
import { consumeOAuthSession } from "@/lib/github-oauth-sessions";
import { saveGithubTokens } from "@/lib/github-token-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/github/oauth/return — browser redirect target that persists the tokens. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const sessionToken = params.get("session")?.trim();
  const accessToken = params.get("access_token")?.trim();
  const refreshToken = params.get("refresh_token");
  const expiresAtRaw = params.get("expires_at");
  const login = params.get("login")?.trim();
  const scopesRaw = params.get("scopes") ?? "";

  if (!sessionToken) {
    return NextResponse.json({ error: "Missing session" }, { status: 400 });
  }

  const session = consumeOAuthSession(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 400 });
  }

  if (!accessToken) {
    return NextResponse.json({ error: "Missing access_token" }, { status: 400 });
  }

  if (!login) {
    return NextResponse.json({ error: "Missing login" }, { status: 400 });
  }

  const expiresAt =
    expiresAtRaw && expiresAtRaw !== "" && !Number.isNaN(Number(expiresAtRaw))
      ? Number(expiresAtRaw)
      : null;

  const scopes = scopesRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  saveGithubTokens(session.projectId, {
    accessToken,
    refreshToken: refreshToken && refreshToken.length > 0 ? refreshToken : null,
    expiresAt,
    login,
    scopes,
  });

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>GitHub connected</title>
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #fafafa; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
      .card { text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #a1a1aa; margin: 0; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>GitHub connected</h1>
      <p id="msg">Signed in as @${escapeHtml(login)}. Closing this window...</p>
    </div>
    <script>
      setTimeout(function () {
        try { window.close(); } catch (e) {}
        var msg = document.getElementById("msg");
        if (msg) msg.textContent = "You can close this window.";
      }, 1000);
    </script>
  </body>
</html>`;

  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
