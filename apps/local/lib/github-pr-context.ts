import { GithubClient } from "./github-client";
import { loadGithubTokens } from "./github-token-store";
import {
  getGithubPr,
  listPrComments,
  upsertPrComments,
} from "./github-pr-store";
import { listPrFiles, upsertPrFiles } from "./github-pr-files-store";
import { logger } from "./logger";
import type { GithubPr, GithubPrComment, GithubPrFile } from "./github-types";

const MAX_PATCH_CHARS = 1500;
const MAX_FILES = 50;
const MAX_COMMENTS = 50;
const FRESH_MS = 10 * 60 * 1000;

function parseRepoId(repoId: string): { owner: string; name: string } | null {
  const [owner, name] = repoId.split("/");
  if (!owner || !name) return null;
  return { owner, name };
}

export function formatPrContext(
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
      const patch =
        f.patch.length > MAX_PATCH_CHARS
          ? f.patch.slice(0, MAX_PATCH_CHARS) + "\n…(truncated)"
          : f.patch;
      return `${header}\n\`\`\`diff\n${patch}\n\`\`\``;
    });
    const more =
      files.length > MAX_FILES ? `\n…and ${files.length - MAX_FILES} more files` : "";
    sections.push(`FILES CHANGED (${files.length})\n${lines.join("\n")}${more}`);
  }

  return sections.join("\n\n");
}

export interface PrContextResult {
  pr: GithubPr;
  context: string;
  counts: { comments: number; files: number };
}

/**
 * Loads a PR with its comments and files, refreshing from GitHub when the
 * cached data is stale or missing. Returns null if the PR is unknown.
 */
export async function ensurePrContext(
  projectId: string,
  prId: string,
  opts: { refresh?: boolean } = {},
): Promise<PrContextResult | null> {
  const pr = getGithubPr(prId);
  if (!pr) return null;

  let comments = listPrComments(prId);
  let files = listPrFiles(prId);

  const commentsStale =
    comments.length === 0 ||
    comments.some((c) => Date.now() - (c.updatedAt || 0) > FRESH_MS);
  const filesStale =
    files.length === 0 ||
    files.some((f) => Date.now() - f.lastSyncedAt > FRESH_MS);

  if (opts.refresh || commentsStale || filesStale) {
    const tokens = loadGithubTokens(projectId);
    const repo = parseRepoId(pr.repoId);
    if (tokens && repo) {
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
  }

  return {
    pr,
    context: formatPrContext(pr, comments, files),
    counts: { comments: comments.length, files: files.length },
  };
}
