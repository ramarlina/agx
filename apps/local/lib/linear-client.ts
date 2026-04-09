import "server-only";

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const AGX_DIR = path.join(homedir(), ".agx");
const TOKEN_FILENAME = "linear-token.json";
const LEGACY_TOKEN_PATH = ".linear-token.json";
const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

interface LinearToken {
  accessToken: string;
  expiresAt?: number;
}

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
  name: string;
}

interface LinearIssueAssignee {
  id: string;
  name: string;
  email: string | null;
}

interface LinearIssueTeam {
  id: string;
  name: string;
  key: string;
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

function getTokenPath(): string {
  return path.join(AGX_DIR, TOKEN_FILENAME);
}

function getLegacyTokenPath(): string {
  return path.join(process.cwd(), LEGACY_TOKEN_PATH);
}

export function getLinearToken(): LinearToken | null {
  // Try the canonical path first
  try {
    const raw = readFileSync(getTokenPath(), "utf8");
    return JSON.parse(raw) as LinearToken;
  } catch {
    // fall through
  }

  // Migrate from legacy cwd-relative path
  try {
    const legacyPath = getLegacyTokenPath();
    const raw = readFileSync(legacyPath, "utf8");
    const token = JSON.parse(raw) as LinearToken;
    // Save to new location and clean up old file
    saveLinearToken(token);
    try { unlinkSync(legacyPath); } catch { /* ignore */ }
    return token;
  } catch {
    return null;
  }
}

export function saveLinearToken(token: LinearToken): void {
  if (!existsSync(AGX_DIR)) {
    mkdirSync(AGX_DIR, { recursive: true });
  }
  writeFileSync(getTokenPath(), JSON.stringify(token, null, 2));
}

export function deleteLinearToken(): void {
  try {
    unlinkSync(getTokenPath());
  } catch {
    // already gone
  }
  // Also clean up legacy location
  try {
    unlinkSync(getLegacyTokenPath());
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
      })),
      pageInfo: data.issues.pageInfo,
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

export function getLinearClient(): LinearClient | null {
  const token = getLinearToken();
  if (!token) return null;
  return new LinearClient(token.accessToken);
}
