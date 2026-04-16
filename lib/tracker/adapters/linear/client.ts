import "server-only";

// TODO(multi-tracker): This file is the Linear adapter boundary.
// To add Jira, GitHub Issues, or another tracker:
//   1. Create a parallel `jira-client.ts` (or `github-issues-client.ts`) with the same exported interface.
//   2. Define a shared `TicketTrackerClient` interface in `lib/ticket-tracker-client.ts` covering:
//      getViewer(), getIssues(), getIssue(), getTeams(), getCycles(), updateIssue(), addComment()
//   3. Replace direct `getLinearClient()` calls in lib/linear-issues.ts and app/api/linear/* with
//      `getTrackerClient(trackerType)` from a factory that reads the per-project tracker config.
//   4. The token/auth storage in this file (linear-token.json) becomes tracker-specific;
//      store under ~/.agx/<tracker>/token.json or a unified credentials store.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const AGX_DIR = path.join(homedir(), ".agx");
const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

export type TicketProvider = "linear";

export interface LinearToken {
  accessToken: string;
  expiresAt?: number;
}

export type TicketProviderToken = LinearToken;

interface LinearGraphQLError {
  message?: string;
}

interface LinearGraphQLResponse<TData> {
  data?: TData;
  errors?: LinearGraphQLError[];
}

interface LinearViewer {
  id: string;
  name: string;
  email: string;
}

export interface LinearUser {
  id: string;
  name: string;
}

interface RawLinearUserNode {
  id: string;
  name: string;
}

export interface LinearTeam {
  id: string;
  name: string;
}

interface RawLinearTeamNode {
  id: string;
  name: string;
}

interface LinearIssueState {
  id?: string;
  name: string;
}

interface LinearIssueAssignee {
  id: string;
  name: string;
  email: string | null;
}

interface LinearIssueAssigneeName {
  name: string;
}

interface LinearIssueTeam {
  id: string;
  name: string;
  key: string;
}

interface RawLinearIssueLabelNode {
  name: string;
}

interface LinearIssueCycle {
  id: string;
  number: number;
  name: string | null;
}

interface RawLinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string | null;
  updatedAt: string;
  state: LinearIssueState | null;
  assignee: LinearIssueAssignee | null;
  team: LinearIssueTeam | null;
  cycle: LinearIssueCycle | null;
  labels: {
    nodes: RawLinearIssueLabelNode[];
  } | null;
}

interface LinearIssueStatusSummary {
  id: string;
  identifier: string;
  title: string;
  url: string | null;
  updatedAt: string;
  status: string;
  assignee: string | null;
}

export interface LinearIssueLabel {
  id: string;
  name: string;
  color: string | null;
  teamId: string | null;
  teamName: string | null;
}

interface RawLinearIssueLabelListNode {
  id: string;
  name: string;
  color: string | null;
  team: {
    id: string;
    name: string;
  } | null;
}

export interface CreateLinearIssueLabelInput {
  name: string;
  description?: string;
  color?: string;
  teamId?: string | null;
}

export interface CreateLinearIssueInput {
  title: string;
  description?: string;
  teamId: string;
  assigneeId?: string;
  cycleId?: string;
  projectId?: string;
  stateId?: string;
  priority?: number;
  labelIds?: string[];
}

export interface CreatedLinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string | null;
  updatedAt: string;
  status: string | null;
  assignee: string | null;
  teamId: string | null;
  teamName: string | null;
  teamKey: string | null;
  labels: string[];
}

interface RawLinearTeamStateNode {
  id: string;
  name: string;
  position: number;
}

type LinearIssueFilter = Record<string, unknown>;

export interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string | null;
  updatedAt: string;
  state: Promise<LinearIssueState | null>;
  assignee: Promise<LinearIssueAssignee | null>;
  team: Promise<LinearIssueTeam | null>;
  cycle: Promise<LinearIssueCycle | null>;
  labels: Promise<string[]>;
}

interface LinearIssueStatusTarget {
  id: string;
  teamId: string | null;
  currentStateId: string | null;
  currentStatus: string | null;
}

export interface LinearCycle {
  id: string;
  number: number;
  name: string | null;
  startsAt: string;
  endsAt: string;
  teamId: string | null;
  teamName: string | null;
}

interface RawLinearCycleNode {
  id: string;
  number: number;
  name: string | null;
  startsAt: string;
  endsAt: string;
  team: {
    id: string;
    name: string;
  } | null;
}

interface LinearIssueConnection {
  nodes: LinearIssueNode[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

function getProjectTokenPath(projectId: string, provider: TicketProvider): string {
  return path.join(AGX_DIR, "projects", projectId, "integrations", `${provider}.json`);
}

export function getProjectTicketToken(
  projectId: string,
  provider: TicketProvider,
): TicketProviderToken | null {
  if (!projectId) return null;
  try {
    const raw = readFileSync(getProjectTokenPath(projectId, provider), "utf8");
    return JSON.parse(raw) as TicketProviderToken;
  } catch {
    return null;
  }
}

export function saveProjectTicketToken(
  projectId: string,
  provider: TicketProvider,
  token: TicketProviderToken,
): void {
  if (!projectId) {
    throw new Error("projectId is required to save a ticket token");
  }
  const tokenPath = getProjectTokenPath(projectId, provider);
  const dir = path.dirname(tokenPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(tokenPath, JSON.stringify(token, null, 2));
}

export function deleteProjectTicketToken(
  projectId: string,
  provider: TicketProvider,
): void {
  if (!projectId) return;
  try {
    unlinkSync(getProjectTokenPath(projectId, provider));
  } catch {
    // already gone
  }
}

function serializeGraphQLValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(serializeGraphQLValue).join(", ")}]`;
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, child]) => child !== undefined);
    return `{ ${entries
      .map(([key, child]) => `${key}: ${serializeGraphQLValue(child)}`)
      .join(", ")} }`;
  }

  throw new Error(`Unsupported GraphQL value: ${typeof value}`);
}

function buildIssuesArguments(params: {
  first: number;
  after?: string;
  filter?: LinearIssueFilter;
  orderBy?: string;
}): string {
  const args = [`first: ${params.first}`];

  if (params.after) {
    args.push(`after: ${JSON.stringify(params.after)}`);
  }

  if (params.orderBy) {
    args.push(`orderBy: ${params.orderBy}`);
  }

  if (params.filter && Object.keys(params.filter).length > 0) {
    args.push(`filter: ${serializeGraphQLValue(params.filter)}`);
  }

  return args.join(", ");
}

export class LinearClient {
  constructor(private readonly accessToken: string) {}

  get viewer(): Promise<LinearViewer> {
    return this.request<{ viewer: LinearViewer }>(
      `query { viewer { id name email } }`,
    ).then((data) => data.viewer);
  }

  async users(): Promise<LinearUser[]> {
    const data = await this.request<{
      users: {
        nodes: RawLinearUserNode[];
      };
    }>(
      `query {
        users(first: 100) {
          nodes {
            id
            name
          }
        }
      }`,
    );

    return data.users.nodes
      .filter((user) => user.name.trim().length > 0)
      .map((user) => ({
        id: user.id,
        name: user.name,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async teams(): Promise<LinearTeam[]> {
    const data = await this.request<{
      teams: {
        nodes: RawLinearTeamNode[];
      };
    }>(
      `query {
        teams(first: 50) {
          nodes {
            id
            name
          }
        }
      }`,
    );

    return data.teams.nodes
      .filter((team) => team.name.trim().length > 0)
      .map((team) => ({
        id: team.id,
        name: team.name,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async issueLabels(): Promise<LinearIssueLabel[]> {
    const data = await this.request<{
      issueLabels: {
        nodes: RawLinearIssueLabelListNode[];
      };
    }>(
      `query {
        issueLabels(first: 250, includeArchived: false) {
          nodes {
            id
            name
            color
            team {
              id
              name
            }
          }
        }
      }`
    );

    return data.issueLabels.nodes
      .filter((label) => label.name.trim().length > 0)
      .map((label) => ({
        id: label.id,
        name: label.name.trim(),
        color: label.color,
        teamId: label.team?.id ?? null,
        teamName: label.team?.name ?? null,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async createIssueLabel(input: CreateLinearIssueLabelInput): Promise<LinearIssueLabel> {
    const name = input.name.trim();
    if (!name) {
      throw new Error("Linear label name is required");
    }

    const payload = {
      name,
      ...(input.description?.trim()
        ? { description: input.description.trim() }
        : {}),
      ...(input.color?.trim() ? { color: input.color.trim() } : {}),
      ...(input.teamId?.trim() ? { teamId: input.teamId.trim() } : {}),
    };

    const result = await this.request<{
      issueLabelCreate: {
        success: boolean;
        issueLabel: RawLinearIssueLabelListNode;
      };
    }>(
      `mutation {
        issueLabelCreate(input: ${serializeGraphQLValue(payload)}) {
          success
          issueLabel {
            id
            name
            color
            team {
              id
              name
            }
          }
        }
      }`
    ).then((data) => data.issueLabelCreate);

    if (!result.success) {
      throw new Error(`Linear rejected the label creation for "${name}"`);
    }

    return {
      id: result.issueLabel.id,
      name: result.issueLabel.name.trim(),
      color: result.issueLabel.color,
      teamId: result.issueLabel.team?.id ?? null,
      teamName: result.issueLabel.team?.name ?? null,
    };
  }

  async issues(params: {
    first: number;
    after?: string;
    filter?: LinearIssueFilter;
    orderBy?: string;
  }): Promise<LinearIssueConnection> {
    const args = buildIssuesArguments(params);
    const data = await this.request<{
      issues: {
        nodes: RawLinearIssueNode[];
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
      };
    }>(
      `query {
        issues(${args}) {
          nodes {
            id
            identifier
            title
            description
            url
            updatedAt
            state { name }
            assignee { id name email }
            team { id name key }
            cycle { id number name }
            labels(first: 20) {
              nodes {
                name
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }`,
    );

    return {
      nodes: data.issues.nodes.map((issue) => ({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        url: issue.url,
        updatedAt: issue.updatedAt,
        state: Promise.resolve(issue.state),
        assignee: Promise.resolve(issue.assignee),
        team: Promise.resolve(issue.team),
        cycle: Promise.resolve(issue.cycle),
        labels: Promise.resolve(
          (issue.labels?.nodes ?? [])
            .map((label) => label.name.trim())
            .filter(Boolean)
        ),
      })),
      pageInfo: data.issues.pageInfo,
    };
  }

  async createIssue(input: CreateLinearIssueInput): Promise<CreatedLinearIssue> {
    const title = input.title.trim();
    const teamId = input.teamId.trim();

    if (!title) {
      throw new Error("Linear issue title is required");
    }
    if (!teamId) {
      throw new Error("Linear issue team is required");
    }

    const payload = {
      title,
      teamId,
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      ...(input.assigneeId?.trim() ? { assigneeId: input.assigneeId.trim() } : {}),
      ...(input.cycleId?.trim() ? { cycleId: input.cycleId.trim() } : {}),
      ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
      ...(input.stateId?.trim() ? { stateId: input.stateId.trim() } : {}),
      ...(typeof input.priority === "number" && Number.isFinite(input.priority)
        ? { priority: Math.trunc(input.priority) }
        : {}),
      ...(input.labelIds?.length
        ? {
            labelIds: Array.from(
              new Set(
                input.labelIds
                  .map((labelId) => labelId.trim())
                  .filter(Boolean)
              )
            ),
          }
        : {}),
    };

    const result = await this.request<{
      issueCreate: {
        success: boolean;
        issue: RawLinearIssueNode | null;
      };
    }>(
      `mutation {
        issueCreate(input: ${serializeGraphQLValue(payload)}) {
          success
          issue {
            id
            identifier
            title
            description
            url
            updatedAt
            state { name }
            assignee { id name email }
            team { id name key }
            cycle { id number name }
            labels(first: 20) {
              nodes {
                name
              }
            }
          }
        }
      }`
    ).then((data) => data.issueCreate);

    if (!result.success || !result.issue) {
      throw new Error(`Linear rejected the issue creation for "${title}"`);
    }

    return {
      id: result.issue.id,
      identifier: result.issue.identifier,
      title: result.issue.title,
      description: result.issue.description,
      url: result.issue.url,
      updatedAt: result.issue.updatedAt,
      status: result.issue.state?.name ?? null,
      assignee: result.issue.assignee?.name ?? null,
      teamId: result.issue.team?.id ?? null,
      teamName: result.issue.team?.name ?? null,
      teamKey: result.issue.team?.key ?? null,
      labels: (result.issue.labels?.nodes ?? [])
        .map((label) => label.name.trim())
        .filter(Boolean),
    };
  }

  async cycles(): Promise<LinearCycle[]> {
    const data = await this.request<{
      teams: {
        nodes: Array<{
          id: string;
          name: string;
          activeCycle: RawLinearCycleNode | null;
          cycles: {
            nodes: RawLinearCycleNode[];
          };
        }>;
      };
    }>(
      `query {
        teams(first: 50) {
          nodes {
            id
            name
            activeCycle {
              id
              number
              name
              startsAt
              endsAt
              team {
                id
                name
              }
            }
            cycles(first: 20) {
              nodes {
                id
                number
                name
                startsAt
                endsAt
                team {
                  id
                  name
                }
              }
            }
          }
        }
      }`,
    );

    const deduped = new Map<string, LinearCycle>();
    for (const team of data.teams.nodes) {
      const cycleNodes = [
        ...(team.activeCycle ? [team.activeCycle] : []),
        ...team.cycles.nodes,
      ];

      for (const cycle of cycleNodes) {
        if (deduped.has(cycle.id)) {
          continue;
        }

        deduped.set(cycle.id, {
          id: cycle.id,
          number: cycle.number,
          name: cycle.name,
          startsAt: cycle.startsAt,
          endsAt: cycle.endsAt,
          teamId: cycle.team?.id ?? team.id,
          teamName: cycle.team?.name ?? team.name,
        });
      }
    }

    return [...deduped.values()].sort(
      (left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime()
    );
  }

  async updateIssueStatus(
    issueId: string,
    statusName: string
  ): Promise<LinearIssueStatusSummary> {
    const normalizedIssueId = issueId.trim();
    const normalizedStatusName = statusName.trim();

    if (!normalizedIssueId) {
      throw new Error("Issue id is required");
    }
    if (!normalizedStatusName) {
      throw new Error("Status name is required");
    }

    const issue = await this.request<{ issue: {
      id: string;
      team: { id: string } | null;
      state: { id: string; name: string } | null;
    } | null }>(
      `query {
        issue(id: ${JSON.stringify(normalizedIssueId)}) {
          id
          team { id }
          state { id name }
        }
      }`
    ).then((data): LinearIssueStatusTarget | null => {
      if (!data.issue) {
        return null;
      }
      return {
        id: data.issue.id,
        teamId: data.issue.team?.id ?? null,
        currentStateId: data.issue.state?.id ?? null,
        currentStatus: data.issue.state?.name ?? null,
      };
    });

    if (!issue) {
      throw new Error(`Issue "${normalizedIssueId}" not found in Linear`);
    }

    if (!issue.teamId) {
      throw new Error(`Issue "${normalizedIssueId}" is missing a team in Linear`);
    }

    if (issue.currentStatus?.trim().toLowerCase() === normalizedStatusName.toLowerCase()) {
      const currentStateName = issue.currentStatus.trim();
      return await this.request<{ issue: {
        id: string;
        identifier: string;
        title: string;
        url: string | null;
        updatedAt: string;
        state: LinearIssueState | null;
        assignee: LinearIssueAssigneeName | null;
      } | null }>(
        `query {
          issue(id: ${JSON.stringify(normalizedIssueId)}) {
            id
            identifier
            title
            url
            updatedAt
            state { name }
            assignee { name }
          }
        }`
      ).then((data) => {
        if (!data.issue) {
          throw new Error(`Issue "${normalizedIssueId}" not found in Linear`);
        }
        return {
          id: data.issue.id,
          identifier: data.issue.identifier,
          title: data.issue.title,
          url: data.issue.url,
          updatedAt: data.issue.updatedAt,
          status: data.issue.state?.name ?? currentStateName,
          assignee: data.issue.assignee?.name ?? null,
        };
      });
    }

    const states = await this.request<{ team: { states: { nodes: RawLinearTeamStateNode[] } | null } | null }>(
      `query {
        team(id: ${JSON.stringify(issue.teamId)}) {
          states {
            nodes {
              id
              name
              position
            }
          }
        }
      }`
    ).then((data) => data.team?.states?.nodes ?? []);

    const targetState = states
      .slice()
      .sort((left, right) => left.position - right.position)
      .find((state) => state.name.trim().toLowerCase() === normalizedStatusName.toLowerCase());

    if (!targetState) {
      throw new Error(`Linear status "${normalizedStatusName}" was not found for this issue's team`);
    }

    const mutation = await this.request<{ issueUpdate: {
      success: boolean;
      issue: {
        id: string;
        identifier: string;
        title: string;
        url: string | null;
        updatedAt: string;
        state: LinearIssueState | null;
        assignee: LinearIssueAssigneeName | null;
      } | null;
    } }>(
      `mutation {
        issueUpdate(
          id: ${JSON.stringify(normalizedIssueId)},
          input: { stateId: ${JSON.stringify(targetState.id)} }
        ) {
          success
          issue {
            id
            identifier
            title
            url
            updatedAt
            state { name }
            assignee { name }
          }
        }
      }`
    ).then((data) => data.issueUpdate);

    if (!mutation.success || !mutation.issue) {
      throw new Error(`Linear rejected the status update for "${normalizedIssueId}"`);
    }

    return {
      id: mutation.issue.id,
      identifier: mutation.issue.identifier,
      title: mutation.issue.title,
      url: mutation.issue.url,
      updatedAt: mutation.issue.updatedAt,
      status: mutation.issue.state?.name ?? normalizedStatusName,
      assignee: mutation.issue.assignee?.name ?? null,
    };
  }

  private async request<TData>(query: string): Promise<TData> {
    const response = await fetch(LINEAR_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.accessToken,
      },
      body: JSON.stringify({ query }),
      cache: "no-store",
    });

    const payload =
      (await response.json()) as LinearGraphQLResponse<TData>;

    if (!response.ok || payload.errors?.length) {
      const message =
        payload.errors?.map((error) => error.message).find(Boolean) ??
        `Linear request failed with status ${response.status}`;
      throw new Error(message);
    }

    if (!payload.data) {
      throw new Error("Linear response did not include data");
    }

    return payload.data;
  }
}

export function getLinearClient(projectId: string): LinearClient | null {
  if (!projectId) return null;
  const token = getProjectTicketToken(projectId, "linear");
  if (!token) return null;
  return new LinearClient(token.accessToken);
}
