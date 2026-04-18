import { GithubClient } from "./github-client";
import {
  upsertGithubPr,
  deleteAutoPrLinks,
  upsertPrLink,
} from "./github-pr-store";
import { upsertGithubIssue } from "./github-issue-store";
import { markRepoSynced } from "./github-repo-store";
import { resolvePrLink, type TrackerResolver } from "./github-link-resolver";
import type { GithubPr } from "./github-types";

export interface SyncRepoInput {
  repoId: string;
  client: Pick<GithubClient, "listPullRequests"> &
    Partial<Pick<GithubClient, "enrichPrStatus" | "listIssues">>;
  resolvers: TrackerResolver[];
  /** When true, skip the AGX_GITHUB_ENABLED env gate (user-initiated sync). */
  force?: boolean;
  /** When true, also fetch and upsert issues. Defaults to false for back-compat. */
  includeIssues?: boolean;
}

function isEnabled(): boolean {
  return process.env.AGX_GITHUB_ENABLED === "1";
}

function parseRepoId(repoId: string): { owner: string; name: string } {
  const [owner, name] = repoId.split("/");
  if (!owner || !name) throw new Error(`invalid repoId ${repoId}`);
  return { owner, name };
}

export async function syncRepo(input: SyncRepoInput): Promise<void> {
  if (!input.force && !isEnabled()) return;
  const { owner, name } = parseRepoId(input.repoId);
  const prs = await input.client.listPullRequests({ owner, name });
  const enrich = input.client.enrichPrStatus?.bind(input.client);
  for (const pr of prs) {
    const enriched = enrich ? await enrich(pr) : pr;
    await upsertAndResolve(enriched, input.resolvers);
  }
  if (input.includeIssues && input.client.listIssues) {
    const issues = await input.client.listIssues({ owner, name });
    for (const issue of issues) upsertGithubIssue(issue);
  }
  markRepoSynced(input.repoId, Date.now());
}

async function upsertAndResolve(
  pr: GithubPr,
  resolvers: TrackerResolver[],
): Promise<void> {
  upsertGithubPr(pr);
  const resolved = await resolvePrLink(
    { headRef: pr.headRef, title: pr.title, body: pr.body },
    resolvers,
  );
  deleteAutoPrLinks(pr.id);
  if (resolved) {
    upsertPrLink({
      prId: pr.id,
      targetType: resolved.targetType,
      targetId: resolved.targetId,
      linkSource: resolved.linkSource,
    });
  }
}
