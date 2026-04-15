import { NextRequest, NextResponse } from "next/server";
import { LOCAL_USER } from "@/lib/auth-mode";
import { loadDbParticipants } from "@/lib/agent-participants";
import { db } from "@/lib/db-instance";
import { stripMarkers } from "@/lib/chat-utils";
import {
  ensureLinearIssueCache,
  listLinearIssueSummaries,
} from "@/lib/linear-issues";
import type { ProjectSearchResponse, ProjectSearchResult } from "@/lib/project-search";
import { readProjectObjectivesWorkspace } from "@/lib/project-objectives";
import { getProjectThreadIds, loadHistory, searchMessages } from "@/lib/history-store";
import { getPromptJobStore } from "@/src/prompt-scheduler/get-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeQuery(value: string | null): string {
  return value?.trim() ?? "";
}

function cleanText(value: string | null | undefined): string {
  if (!value) return "";
  return stripMarkers(value).replace(/\s+/g, " ").trim();
}

function stripSearchMarkup(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/<\/?mark>/g, "");
}

function shorten(value: string, max = 120): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function matchesQuery(query: string, ...values: Array<string | null | undefined>): boolean {
  const terms = normalizeSearchText(query)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return false;

  const haystack = values
    .map((value) => normalizeSearchText(cleanText(value)))
    .filter(Boolean)
    .join(" ");

  return terms.every((term) => haystack.includes(term));
}

function scoreQueryMatch(query: string, ...values: Array<string | null | undefined>): number {
  const haystacks = values
    .map((value) => normalizeSearchText(cleanText(value)))
    .filter(Boolean);
  if (haystacks.length === 0) return Number.POSITIVE_INFINITY;

  const normalizedQuery = normalizeSearchText(query);
  const termScores = normalizedQuery
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .map((term) => {
      let bestIndex = Number.POSITIVE_INFINITY;
      for (const haystack of haystacks) {
        const index = haystack.indexOf(term);
        if (index >= 0) {
          bestIndex = Math.min(bestIndex, index);
        }
      }
      return bestIndex;
    });

  return termScores.reduce((sum, score) => sum + (Number.isFinite(score) ? score : 9999), 0);
}

function scoreAgentMatch(
  query: string,
  agent: {
    id?: string | null;
    name: string;
    role?: string | null;
    teamName?: string | null;
  },
): number {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedName = normalizeSearchText(agent.name);

  if (!normalizedQuery) {
    return Number.POSITIVE_INFINITY;
  }
  if (normalizedName === normalizedQuery) {
    return -300;
  }
  if (normalizedName.startsWith(normalizedQuery)) {
    return -200;
  }
  if (normalizedName.includes(normalizedQuery)) {
    return -100;
  }

  return scoreQueryMatch(
    query,
    agent.id,
    agent.name,
    agent.role,
    agent.teamName,
  );
}

function buildChatHref(
  projectSlug: string,
  threadId: string,
  rootMessageId: string,
  messageId?: string,
): string {
  const params = new URLSearchParams({ open: rootMessageId });
  if (messageId && messageId !== rootMessageId) {
    params.set("message", messageId);
  }
  return `/projects/${projectSlug}/thread/${encodeURIComponent(threadId)}?${params.toString()}`;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const query = normalizeQuery(request.nextUrl.searchParams.get("q"));
  if (!query) {
    return NextResponse.json<ProjectSearchResponse>({
      query,
      sections: [],
      total: 0,
    });
  }

  if (query.length < 2) {
    return NextResponse.json<ProjectSearchResponse>({
      query,
      sections: [],
      total: 0,
    });
  }

  const { id } = await context.params;
  const projectId = id.trim();
  if (!projectId) {
    return NextResponse.json({ error: "Project id is required" }, { status: 400 });
  }

  const project = await db.getProjectWithRepos(projectId, LOCAL_USER.id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const [teams, projectAgents, participants, projectThreadIds] = await Promise.all([
    db.getTeams(project.id),
    db.getProjectAgents(project.id),
    loadDbParticipants(),
    getProjectThreadIds(project.id),
  ]);
  const teamAgentsByTeam = new Map(
    await Promise.all(
      teams.map(async (team) => [team.id, await db.getTeamAgents(team.id)] as const),
    ),
  );

  const teamNameById = new Map(teams.map((team) => [team.id, team.name]));
  const teamMetadataDescriptionById = new Map(
    teams.map((team) => [
      team.id,
      typeof team.metadata?.description === "string" ? team.metadata.description : null,
    ]),
  );
  const primaryTeamByAgentId = new Map<string, { teamId: string; teamName: string }>();
  for (const team of teams) {
    const teamAgents = teamAgentsByTeam.get(team.id) ?? [];
    for (const teamAgent of teamAgents) {
      if (!primaryTeamByAgentId.has(teamAgent.agent_id)) {
        primaryTeamByAgentId.set(teamAgent.agent_id, {
          teamId: team.id,
          teamName: team.name,
        });
      }
    }
  }

  const objectives = readProjectObjectivesWorkspace(project.metadata).objectives
    .filter((objective) =>
      matchesQuery(query, objective.title, objective.summary, teamNameById.get(objective.teamId))
    )
    .sort(
      (left, right) =>
        scoreQueryMatch(query, left.title, left.summary) -
        scoreQueryMatch(query, right.title, right.summary),
    )
    .slice(0, 10)
    .map<ProjectSearchResult>((objective) => ({
      id: objective.id,
      kind: "objective",
      label: "Objective",
      title: objective.title,
      context: teamNameById.get(objective.teamId) ?? undefined,
      description: shorten(cleanText(objective.summary), 120) || undefined,
      href: `/projects/${project.slug}/objectives/${encodeURIComponent(objective.id)}`,
    }));

  const scheduledTasks = getPromptJobStore()
    .listJobs({ projectId: project.id })
    .filter((job) => matchesQuery(query, job.name, job.prompt, job.condition, job.cadence, job.cronExpr))
    .sort(
      (left, right) =>
        scoreQueryMatch(query, left.name, left.prompt, left.condition) -
        scoreQueryMatch(query, right.name, right.prompt, right.condition),
    )
    .slice(0, 10)
    .map<ProjectSearchResult>((job) => ({
      id: job.id,
      kind: "scheduled_task",
      label: "Scheduled task",
      title: job.name,
      context: job.state === "active" ? "Active" : job.state === "paused" ? "Paused" : "Stopped",
      description: shorten(cleanText(job.prompt || job.condition || job.cadence), 120) || undefined,
      href: `/projects/${project.slug}/automations?job=${encodeURIComponent(job.id)}`,
    }));

  const matchedTeams = teams
    .filter((team) =>
      matchesQuery(
        query,
        team.name,
        team.template_id,
        teamMetadataDescriptionById.get(team.id),
      ),
    )
    .sort(
      (left, right) =>
        scoreQueryMatch(
          query,
          left.name,
          left.template_id,
          teamMetadataDescriptionById.get(left.id),
        ) -
        scoreQueryMatch(
          query,
          right.name,
          right.template_id,
          teamMetadataDescriptionById.get(right.id),
        ),
    )
    .slice(0, 10)
    .map<ProjectSearchResult>((team) => ({
      id: team.id,
      kind: "team",
      label: "Team",
      title: team.name,
      context: team.template_id ?? undefined,
      description: shorten(cleanText(teamMetadataDescriptionById.get(team.id)), 120) || undefined,
      href: `/projects/${project.slug}/teams?team=${encodeURIComponent(team.id)}`,
    }));

  const projectAgentIds = new Set(projectAgents.map((agent) => agent.agent_id));
  const agents = participants
    .filter((agent) => projectAgentIds.has(agent.id))
    .filter((agent) => {
      const primaryTeam = primaryTeamByAgentId.get(agent.id);
      return matchesQuery(query, agent.id, agent.name, agent.role, primaryTeam?.teamName);
    })
    .sort(
      (left, right) => {
        const leftPrimaryTeam = primaryTeamByAgentId.get(left.id);
        const rightPrimaryTeam = primaryTeamByAgentId.get(right.id);
        return (
          scoreAgentMatch(query, {
            id: left.id,
            name: left.name,
            role: left.role,
            teamName: leftPrimaryTeam?.teamName,
          }) -
          scoreAgentMatch(query, {
            id: right.id,
            name: right.name,
            role: right.role,
            teamName: rightPrimaryTeam?.teamName,
          })
        );
      },
    )
    .slice(0, 10)
    .map<ProjectSearchResult>((agent) => ({
      id: agent.id,
      kind: "agent",
      label: "Agent",
      title: agent.name,
      context:
        primaryTeamByAgentId.get(agent.id)?.teamName ??
        agent.role ??
        agent.provider ??
        undefined,
      description: shorten(cleanText(agent.identity || agent.model || ""), 120) || undefined,
      href: primaryTeamByAgentId.has(agent.id)
        ? `/projects/${project.slug}/teams/${encodeURIComponent(primaryTeamByAgentId.get(agent.id)!.teamId)}/agents/${encodeURIComponent(agent.id)}`
        : `/agents/${encodeURIComponent(agent.id)}`,
    }));

  let linearIssues: ProjectSearchResult[] = [];
  try {
    await ensureLinearIssueCache({ projectId: project.id, projectSlug: project.slug });
    const response = await listLinearIssueSummaries({
      search: query,
      limit: 10,
    });
    linearIssues = response.issues
      .filter((issue) =>
        matchesQuery(
          query,
          issue.identifier,
          issue.title,
          issue.status,
          issue.assignee,
          issue.labels?.join(" "),
        ),
      )
      .sort(
        (left, right) =>
          scoreQueryMatch(
            query,
            left.identifier,
            left.title,
            left.status,
            left.assignee,
            left.labels?.join(" "),
          ) -
          scoreQueryMatch(
            query,
            right.identifier,
            right.title,
            right.status,
            right.assignee,
            right.labels?.join(" "),
          ),
      )
      .map((issue) => ({
        id: issue.id,
        kind: "linear_issue",
        label: "Linear",
        title: `${issue.identifier} ${issue.title}`.trim(),
        context: issue.status || undefined,
        description: issue.assignee ? `Assignee: ${issue.assignee}` : undefined,
        href: `/projects/${project.slug}/linear?issue=${encodeURIComponent(issue.id)}`,
      }));
  } catch (error) {
    console.warn("Project search failed to load Linear issues", error);
  }

  let chatResults: ProjectSearchResult[] = [];
  if (projectThreadIds.length > 0) {
    const messageSearch = await searchMessages({
      query,
      threadIds: projectThreadIds,
      limit: 10,
      offset: 0,
    });

    const historyEntries = await Promise.all(
      Array.from(new Set(messageSearch.results.map((result) => result.threadId))).map(async (threadId) => [
        threadId,
        await loadHistory(threadId),
      ] as const),
    );
    const historyByThread = new Map(historyEntries);

    chatResults = messageSearch.results.map((result) => {
      const rootMessageId = result.rootMessageId || result.messageId;
      const history = historyByThread.get(result.threadId) ?? [];
      const rootMessage = history.find((message) => message.id === rootMessageId) ?? null;
      const rootTitle = shorten(cleanText(rootMessage?.content || stripSearchMarkup(result.snippet)), 72);
      const kind = result.rootMessageId ? "chat_message" : "chat_thread";

      return {
        id: `${result.threadId}:${result.messageId}`,
        kind,
        label: kind === "chat_thread" ? "Chat conversation" : "Chat message",
        title: rootTitle || "Chat conversation",
        context: new Date(result.timestamp).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
        description: result.snippet || undefined,
        href: buildChatHref(project.slug, result.threadId, rootMessageId, result.messageId),
      };
    });
  }

  const sections = [
    { id: "objectives", label: "Objectives", results: objectives },
    { id: "linear", label: "Linear", results: linearIssues },
    { id: "scheduled_tasks", label: "Scheduled Tasks", results: scheduledTasks },
    { id: "teams", label: "Teams", results: matchedTeams },
    { id: "agents", label: "Agents", results: agents },
    { id: "chat", label: "Chat", results: chatResults },
  ].filter((section) => section.results.length > 0);

  const total = sections.reduce((sum, section) => sum + section.results.length, 0);
  return NextResponse.json<ProjectSearchResponse>({
    query,
    sections,
    total,
  });
}
