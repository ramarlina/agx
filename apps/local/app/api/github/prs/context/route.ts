import { NextRequest, NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { GithubClient } from "@/lib/github-client";
import { loadGithubTokens } from "@/lib/github-token-store";
import { getGithubPr, listPrComments, upsertPrComments } from "@/lib/github-pr-store";
import { listPrFiles, upsertPrFiles } from "@/lib/github-pr-files-store";
import { logger } from "@/lib/logger";
import type { GithubPr, GithubPrComment, GithubPrFile } from "@/lib/github-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PATCH_CHARS = 1500;
const MAX_FILES = 50;
const MAX_COMMENTS = 50;
const FRESH_MS = 10 * 60 * 1000;

function parseRepoId(repoId: string): { owner: string; name: string } | null {
  const [owner, name] = repoId.split("/");
  if (!owner || !name) return null;
  return { owner, name };
}

function formatContext(
  pr: GithubPr,
  comments: GithubPrComment[],
  files: GithubPrFile[],
): string {
  const sections: string[] = [];
  sections.push(
    [
      `PR CONTEXT — ${pr.id}`,
      `Title: ${pr.title}`,
      `Author: ${pr.authorLogin || "unknown"}`,
      `State: ${pr.state}${pr.draft ? " (draft)" : ""}`,
      `Branch: ${pr.headRef} → ${pr.baseRef}`,
      `URL: ${pr.url}`,
    ].join("\n"),
  );
  sections.push(`DESCRIPTION\n${pr.body?.trim() || "(no description)"}`);

  if (comments.length > 0) {
    const shown = comments.slice(-MAX_COMMENTS);
    const lines = shown.map((c) => {
      const loc =
        c.kind === "review_comment" && c.path
          ? ` [${c.path}${c.line != null ? `:${c.line}` : ""}]`
          : "";
      return `- @${c.authorLogin || "unknown"}${loc}: ${c.body?.trim() || ""}`;
    });
    sections.push(`COMMENTS (${comments.length})\n${lines.join("\n")}`);
  }

  if (files.length > 0) {
    const shown = files.slice(0, MAX_FILES);
    const lines = shown.map((f) => {
      const header = `- ${f.path} [${f.status}] +${f.additions}/-${f.deletions}`;
      if (!f.patch) return header;
      const patch = f.patch.length > MAX_PATCH_CHARS
        ? f.patch.slice(0, MAX_PATCH_CHARS) + "\n…(truncated)"
        : f.patch;
      return `${header}\n\`\`\`diff\n${patch}\n\`\`\``;
    });
    const more = files.length > MAX_FILES ? `\n…and ${files.length - MAX_FILES} more files` : "";
    sections.push(`FILES CHANGED (${files.length})\n${lines.join("\n")}${more}`);
  }

  return sections.join("\n\n");
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    const prId = typeof body.prId === "string" ? body.prId.trim() : "";
    const refresh = body.refresh === true;
    if (!projectId || !prId) {
      return NextResponse.json(
        { error: "projectId and prId are required" },
        { status: 400 },
      );
    }

    const pr = getGithubPr(prId);
    if (!pr) {
      return NextResponse.json({ error: "PR not found" }, { status: 404 });
    }

    let comments = listPrComments(prId);
    let files = listPrFiles(prId);

    const commentsStale =
      comments.length === 0 ||
      comments.some((c) => Date.now() - (c.updatedAt || 0) > FRESH_MS);
    const filesStale =
      files.length === 0 ||
      files.some((f) => Date.now() - f.lastSyncedAt > FRESH_MS);

    if (refresh || commentsStale || filesStale) {
      const tokens = loadGithubTokens(projectId);
      if (!tokens) {
        return NextResponse.json(
          { error: "GitHub is not connected for this project" },
          { status: 401 },
        );
      }
      const repo = parseRepoId(pr.repoId);
      if (!repo) {
        return NextResponse.json({ error: "invalid repoId" }, { status: 500 });
      }
      const client = new GithubClient({ tokens });
      try {
        const [freshComments, freshFiles] = await Promise.all([
          client.listPullRequestComments({ ...repo, number: pr.number }),
          client.listPullRequestFiles({ ...repo, number: pr.number }),
        ]);
        upsertPrComments(freshComments);
        upsertPrFiles(freshFiles);
        comments = listPrComments(prId);
        files = listPrFiles(prId);
      } catch (err) {
        logger.error("pr context fetch failed", logger.formatError(err));
      }
    }

    const context = formatContext(pr, comments, files);
    return NextResponse.json({
      ok: true,
      context,
      counts: { comments: comments.length, files: files.length },
    });
  } catch (error) {
    logger.error("Error building PR context", logger.formatError(error));
    return NextResponse.json({ error: "Failed to build PR context" }, { status: 500 });
  }
}
