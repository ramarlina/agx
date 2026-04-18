import { NextRequest, NextResponse } from "next/server";
import { loadGithubTokens } from "@/lib/github-token-store";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GithubApiRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  updated_at: string;
  owner: { login: string; avatar_url: string };
}

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const tokens = loadGithubTokens(projectId);
  if (!tokens) {
    return NextResponse.json({ error: "GitHub not connected" }, { status: 401 });
  }

  try {
    const headers = {
      Authorization: `token ${tokens.accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "agx",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    const all: GithubApiRepo[] = [];
    let page = 1;
    while (page <= 10) {
      const url = `https://api.github.com/user/repos?per_page=100&page=${page}&visibility=all&affiliation=owner,collaborator,organization_member&sort=updated`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        return NextResponse.json(
          { error: `GitHub API error: ${res.status}` },
          { status: 502 },
        );
      }
      const batch = (await res.json()) as GithubApiRepo[];
      all.push(...batch);
      if (batch.length < 100) break;
      page++;
    }

    return NextResponse.json({
      repos: all.map((r) => ({
        id: r.id,
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        description: r.description,
        private: r.private,
        defaultBranch: r.default_branch,
        updatedAt: r.updated_at,
        avatarUrl: r.owner.avatar_url,
      })),
    });
  } catch (error) {
    logger.error("Error fetching user repos", logger.formatError(error));
    return NextResponse.json({ error: "Failed to fetch repos" }, { status: 500 });
  }
}
