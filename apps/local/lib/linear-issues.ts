import "server-only";

import fs from "node:fs";
import path from "node:path";
import { dump } from "js-yaml";
import { getLinearClient } from "./linear-client";
import {
  countCachedLinearIssues,
  getCachedLinearIssueContexts,
  getLinearIssueSyncState,
  listCachedLinearIssues,
  replaceCachedLinearIssues,
  setLinearIssueSyncState,
  type CachedLinearIssueInput,
  type CachedLinearIssueRecord,
  type ListCachedLinearIssuesInput,
} from "./linear-issue-store";
import { vaultStore } from "./vault-store";

const GLOBAL_SCOPE_KEY = "global";
const MAX_PULL_ISSUES = 500;
const PULL_PAGE_SIZE = 100;

export interface LinearIssueSummary {
  id: string;
  identifier: string;
  title: string;
  url: string | null;
  status: string;
  assignee: string | null;
  updatedAt: string;
}

export interface LinearIssueContext extends LinearIssueSummary {
  description: string | null;
  assigneeId: string | null;
  assigneeEmail: string | null;
  isAssignedToMe: boolean;
  teamId: string | null;
  teamName: string | null;
  teamKey: string | null;
  cycleId: string | null;
  cycleName: string | null;
  cycleNumber: number | null;
  pulledAt: string;
}

export interface EnsureLinearIssueCacheInput {
  refresh?: boolean;
  projectSlug?: string | null;
}

export interface PullLinearIssuesResult {
  issueCount: number;
  complete: boolean;
  pulledAt: string;
}

function toScopeKey(projectSlug?: string | null): string {
  const normalized = String(projectSlug ?? "").trim().toLowerCase();
  return normalized ? `project:${normalized}` : GLOBAL_SCOPE_KEY;
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function atomicWriteText(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}

function normalizeMarkdownBody(content: string): string {
  return String(content || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n")
    .trim();
}

function writeMarkdownFile(filePath: string, frontmatter: Record<string, unknown>, body: string): void {
  const yaml = dump(frontmatter, { lineWidth: 120, noRefs: true, sortKeys: true }).trimEnd();
  const normalizedBody = normalizeMarkdownBody(body);
  const content = normalizedBody
    ? `---\n${yaml}\n---\n${normalizedBody}\n`
    : `---\n${yaml}\n---\n`;
  atomicWriteText(filePath, content);
}

function toSummary(issue: CachedLinearIssueRecord): LinearIssueSummary {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    status: issue.status,
    assignee: issue.assignee,
    updatedAt: issue.updatedAt,
  };
}

function toContext(issue: CachedLinearIssueRecord): LinearIssueContext {
  return {
    ...toSummary(issue),
    description: issue.description,
    assigneeId: issue.assigneeId,
    assigneeEmail: issue.assigneeEmail,
    isAssignedToMe: issue.isAssignedToMe,
    teamId: issue.teamId,
    teamName: issue.teamName,
    teamKey: issue.teamKey,
    cycleId: issue.cycleId,
    cycleName: issue.cycleName,
    cycleNumber: issue.cycleNumber,
    pulledAt: issue.pulledAt,
  };
}

function sanitizeIssueDirectoryName(identifier: string, fallback: string): string {
  const normalized = identifier.trim().replace(/[\\/]/g, "-");
  return normalized || fallback;
}

function resolveVaultIssuesRoot(projectSlug?: string | null): string {
  const rootDir = vaultStore.getRootDir();
  const normalizedProjectSlug = String(projectSlug ?? "").trim();

  if (normalizedProjectSlug) {
    const project = vaultStore.getProjectWithRepos(normalizedProjectSlug);
    const resolvedSlug = project?.slug ?? normalizedProjectSlug;
    return path.join(rootDir, resolvedSlug, "issues");
  }

  return path.join(rootDir, "_global", "Linear", "issues");
}

function issueMarkdownBody(issue: CachedLinearIssueInput, pulledAt: string): string {
  const lines = [
    `# ${issue.identifier}: ${issue.title}`,
    "",
    `- Status: ${issue.status}`,
    `- Assignee: ${issue.assignee ?? "Unassigned"}`,
    issue.teamName ? `- Team: ${issue.teamName}` : null,
    issue.cycleName || issue.cycleNumber != null
      ? `- Cycle: ${issue.cycleName ?? `Cycle ${issue.cycleNumber}`}`
      : null,
    `- Updated in Linear: ${issue.updatedAt}`,
    `- Pulled locally: ${pulledAt}`,
    issue.url ? `- URL: ${issue.url}` : null,
    "",
    "## Description",
    "",
    issue.description?.trim() || "_No description provided._",
  ];

  return lines.filter((line): line is string => line !== null).join("\n");
}

function writeLinearIssuesToVault(
  issues: CachedLinearIssueInput[],
  pulledAt: string,
  projectSlug?: string | null
): void {
  const issuesRoot = resolveVaultIssuesRoot(projectSlug);
  ensureDir(issuesRoot);

  const indexLines = [
    "# Linear Issues",
    "",
    `Last pulled: ${pulledAt}`,
    "",
  ];

  for (const issue of issues) {
    const issueDir = path.join(
      issuesRoot,
      sanitizeIssueDirectoryName(issue.identifier, issue.id)
    );
    writeMarkdownFile(
      path.join(issueDir, "README.md"),
      {
        type: "linear-issue",
        issue_id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        status: issue.status,
        assignee_id: issue.assigneeId ?? null,
        assignee_name: issue.assignee ?? null,
        assignee_email: issue.assigneeEmail ?? null,
        team_id: issue.teamId ?? null,
        team_name: issue.teamName ?? null,
        team_key: issue.teamKey ?? null,
        cycle_id: issue.cycleId ?? null,
        cycle_name: issue.cycleName ?? null,
        cycle_number: issue.cycleNumber ?? null,
        url: issue.url ?? null,
        updated_at: issue.updatedAt,
        pulled_at: pulledAt,
      },
      issueMarkdownBody(issue, pulledAt)
    );

    indexLines.push(
      `- [${issue.identifier}](${encodeURIComponent(
        sanitizeIssueDirectoryName(issue.identifier, issue.id)
      )}/README.md) - ${issue.title} (${issue.status})`
    );
  }

  atomicWriteText(path.join(issuesRoot, "_index.md"), `${indexLines.join("\n")}\n`);
}

export async function pullLinearIssues(input: {
  projectSlug?: string | null;
} = {}): Promise<PullLinearIssuesResult> {
  const client = getLinearClient();
  if (!client) {
    throw new Error("Not connected");
  }

  const viewer = await client.viewer;
  const pulledAtMs = Date.now();
  const pulledAt = new Date(pulledAtMs).toISOString();

  let after: string | undefined;
  let totalFetched = 0;
  let complete = true;
  const issues: CachedLinearIssueInput[] = [];

  while (totalFetched < MAX_PULL_ISSUES) {
    const remaining = MAX_PULL_ISSUES - totalFetched;
    const result = await client.issues({
      first: Math.min(PULL_PAGE_SIZE, remaining),
      after,
      orderBy: "updatedAt" as const,
    });

    const pageIssues = await Promise.all(
      result.nodes.map(async (issue) => {
        const [state, assignee, team, cycle] = await Promise.all([
          issue.state,
          issue.assignee,
          issue.team,
          issue.cycle,
        ]);

        return {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description ?? null,
          url: issue.url,
          status: state?.name ?? "Unknown",
          assigneeId: assignee?.id ?? null,
          assignee: assignee?.name ?? null,
          assigneeEmail: assignee?.email ?? null,
          isAssignedToMe: Boolean(assignee?.id && assignee.id === viewer.id),
          teamId: team?.id ?? null,
          teamName: team?.name ?? null,
          teamKey: team?.key ?? null,
          cycleId: cycle?.id ?? null,
          cycleName: cycle?.name ?? null,
          cycleNumber: cycle?.number ?? null,
          updatedAt: issue.updatedAt,
        } satisfies CachedLinearIssueInput;
      })
    );

    issues.push(...pageIssues);
    totalFetched += pageIssues.length;

    if (!result.pageInfo.hasNextPage || !result.pageInfo.endCursor) {
      break;
    }

    if (totalFetched >= MAX_PULL_ISSUES) {
      complete = false;
      break;
    }

    after = result.pageInfo.endCursor;
  }

  await replaceCachedLinearIssues({
    issues,
    complete,
    pulledAtMs,
  });
  await setLinearIssueSyncState(GLOBAL_SCOPE_KEY, issues.length, pulledAtMs);

  const projectScopeKey = toScopeKey(input.projectSlug);
  if (projectScopeKey !== GLOBAL_SCOPE_KEY) {
    await setLinearIssueSyncState(projectScopeKey, issues.length, pulledAtMs);
  }

  writeLinearIssuesToVault(issues, pulledAt, input.projectSlug);

  return {
    issueCount: issues.length,
    complete,
    pulledAt,
  };
}

export async function ensureLinearIssueCache(
  input: EnsureLinearIssueCacheInput = {}
): Promise<PullLinearIssuesResult | null> {
  const refresh = Boolean(input.refresh);
  const scopeKey = toScopeKey(input.projectSlug);

  if (!refresh) {
    const [issueCount, scopeState] = await Promise.all([
      countCachedLinearIssues(),
      getLinearIssueSyncState(scopeKey),
    ]);

    if (issueCount > 0 && scopeState) {
      return null;
    }
  }

  const client = getLinearClient();
  if (!client) {
    return null;
  }

  return pullLinearIssues({ projectSlug: input.projectSlug });
}

export async function listLinearIssueSummaries(
  input: ListCachedLinearIssuesInput = {}
): Promise<{
  issues: LinearIssueSummary[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
  syncState: { lastPulledAt: string | null };
}> {
  const [result, syncState] = await Promise.all([
    listCachedLinearIssues(input),
    getLinearIssueSyncState(GLOBAL_SCOPE_KEY),
  ]);

  return {
    issues: result.issues.map(toSummary),
    pageInfo: result.pageInfo,
    syncState: {
      lastPulledAt: syncState?.lastPulledAt ?? null,
    },
  };
}

export async function getLinearIssueContexts(issueIds: string[]): Promise<LinearIssueContext[]> {
  const issues = await getCachedLinearIssueContexts(issueIds);
  return issues.map(toContext);
}
