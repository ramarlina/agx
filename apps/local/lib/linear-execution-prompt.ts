export interface LinearExecutionIssueContext {
  identifier: string;
  title: string;
  status?: string | null;
  assignee?: string | null;
}

export interface LinearExecutionProjectRepoContext {
  name: string;
  path?: string | null;
  notes?: string | null;
}

export interface LinearExecutionProjectContext {
  name?: string | null;
  slug?: string | null;
  repos?: LinearExecutionProjectRepoContext[] | null;
}

export interface LinearExecutionRuntimeContext {
  knowledgeBaseRoot?: string | null;
  issueKnowledgePath?: string | null;
  isolatedWorktreePath?: string | null;
}

export interface LinearExecutionPromptInput {
  issue: LinearExecutionIssueContext;
  project?: LinearExecutionProjectContext | null;
  runtime?: LinearExecutionRuntimeContext | null;
}

export interface ResolvedLinearExecutionContext {
  issue: {
    identifier: string;
    title: string;
    status: string;
    assignee: string;
  };
  project: {
    name: string;
    slug: string;
    label: string;
    repos: LinearExecutionProjectRepoContext[];
  };
  runtime: {
    knowledgeBaseRoot: string;
    issueKnowledgePath: string;
    isolatedWorktreePath: string;
  };
}

function slugifySegment(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function toProjectSlug(project?: LinearExecutionProjectContext | null): string {
  const explicitSlug = String(project?.slug ?? "").trim();
  if (explicitSlug) {
    return slugifySegment(explicitSlug, "project");
  }

  const projectName = String(project?.name ?? "").trim();
  if (projectName) {
    return slugifySegment(projectName, "project");
  }

  return "project";
}

function toProjectLabel(project?: LinearExecutionProjectContext | null): string {
  const name = String(project?.name ?? "").trim();
  const slug = String(project?.slug ?? "").trim();

  if (name && slug) {
    return `${name} (${slug})`;
  }
  if (name) {
    return name;
  }
  if (slug) {
    return slug;
  }
  return "current project";
}

function formatRepositories(repos?: LinearExecutionProjectRepoContext[] | null): string {
  if (!repos || repos.length === 0) {
    return "- Use the active project context to discover the right repository or workspace; do not hardcode paths.";
  }

  return repos
    .map((repo) => {
      const parts = [repo.name.trim() || "repository"];
      const path = String(repo.path ?? "").trim();
      const notes = String(repo.notes ?? "").trim();

      if (path) {
        parts.push(`path: ${path}`);
      }
      if (notes) {
        parts.push(`notes: ${notes}`);
      }

      return `- ${parts.join(" | ")}`;
    })
    .join("\n");
}

export function buildLinearExecutionPrompt(input: LinearExecutionPromptInput): {
  prompt: string;
  promptPrefix: string;
} {
  const context = resolveLinearExecutionContext(input);
  const issueIdentifier = context.issue.identifier;
  const issueTitle = context.issue.title;
  const issueStatus = context.issue.status;
  const issueAssignee = context.issue.assignee;
  const knowledgeBaseRoot = context.runtime.knowledgeBaseRoot;
  const issueKnowledgePath = context.runtime.issueKnowledgePath;
  const isolatedWorktreePath = context.runtime.isolatedWorktreePath;

  const promptPrefix = [
    "LINEAR TASK EXECUTION",
    "You are an engineer working through a single Linear ticket. Work like a careful teammate: continue existing work when present, investigate before coding, present a plan before implementation, ask clarifying questions when requirements are ambiguous, and stop cleanly when blocked instead of guessing.",
    [
      "INJECTED CONTEXT",
      `- Ticket: ${issueIdentifier}`,
      `- Title: ${issueTitle}`,
      `- Current status: ${issueStatus}`,
      `- Current assignee: ${issueAssignee}`,
      `- Project: ${context.project.label}`,
      `- Knowledge base root: ${knowledgeBaseRoot}`,
      `- Issue knowledge path: ${issueKnowledgePath}`,
      `- Suggested isolated worktree: ${isolatedWorktreePath}`,
      "- Additional project resources such as repo knowledge, project memory, and project variables are injected separately by the active project context.",
    ].join("\n"),
    `SOURCE REPOSITORIES\n${formatRepositories(context.project.repos)}`,
    [
      "WORKFLOW",
      "1. Read the full Linear issue and comment thread before acting. Use Linear MCP for issue details, comments, state changes, and follow-up.",
      "2. Prefer resuming existing work: existing knowledge-base notes, branches, PRs, or prior discussion.",
      "3. If requirements are unclear, ask specific clarifying questions in Linear and stop.",
      "4. If the ticket is fresh, investigate first, capture findings in the knowledge base, write a plan, and share the plan before implementation.",
      "5. If a reviewed plan already exists or the ticket is explicitly ready for implementation, implement in an isolated worktree or equivalent isolated workspace rather than a shared checkout.",
      "6. Validate with the appropriate tests, linting, type checks, and manual verification for the change.",
      "7. Keep Linear accurate: comments, links, statuses, blockers, and PR references should match reality.",
      "8. Keep the knowledge base current with what you learned, what changed, and what remains.",
      "9. Work on exactly this ticket during this session.",
    ].join("\n"),
    [
      "RULES",
      "- Use the injected project context instead of hardcoded repo-specific paths or conventions.",
      "- Use knowledge base terminology; the filesystem path above is the storage location.",
      "- If a PR already exists, focus on CI failures, reviewer feedback, merge status, or ticket follow-up instead of starting over.",
      "- Leave the ticket and the knowledge base in a resumable state at the end of the session. Clean up temporary worktrees or session claims if your workflow created them.",
    ].join("\n"),
  ].join("\n\n") + "\n\n";

  return {
    prompt: `Work on this Linear ticket: ${issueIdentifier} - ${issueTitle}`,
    promptPrefix,
  };
}

export function resolveLinearExecutionContext(
  input: LinearExecutionPromptInput
): ResolvedLinearExecutionContext {
  const issueIdentifier = input.issue.identifier.trim() || "TICKET-ID";
  const issueTitle = input.issue.title.trim() || "Untitled ticket";
  const issueStatus = String(input.issue.status ?? "").trim() || "Unknown";
  const issueAssignee = String(input.issue.assignee ?? "").trim() || "Unassigned";
  const projectSlug = toProjectSlug(input.project);
  const projectName = String(input.project?.name ?? "").trim() || projectSlug;
  const knowledgeBaseRoot =
    String(input.runtime?.knowledgeBaseRoot ?? "").trim() || `~/.agx/vault/${projectSlug}`;
  const issueKnowledgePath =
    String(input.runtime?.issueKnowledgePath ?? "").trim() ||
    `${knowledgeBaseRoot}/issues/${issueIdentifier}/`;
  const isolatedWorktreePath =
    String(input.runtime?.isolatedWorktreePath ?? "").trim() ||
    `/tmp/agx-${slugifySegment(issueIdentifier, "ticket")}`;

  return {
    issue: {
      identifier: issueIdentifier,
      title: issueTitle,
      status: issueStatus,
      assignee: issueAssignee,
    },
    project: {
      name: projectName,
      slug: projectSlug,
      label: toProjectLabel(input.project),
      repos: input.project?.repos ? [...input.project.repos] : [],
    },
    runtime: {
      knowledgeBaseRoot,
      issueKnowledgePath,
      isolatedWorktreePath,
    },
  };
}

export function renderLinearExecutionPromptTemplate(
  template: string,
  input: LinearExecutionPromptInput
): string {
  const context = resolveLinearExecutionContext(input);
  const values: Record<string, string> = {
    "ticket.identifier": context.issue.identifier,
    "ticket.title": context.issue.title,
    "ticket.status": context.issue.status,
    "ticket.assignee": context.issue.assignee,
    "project.name": context.project.name,
    "project.slug": context.project.slug,
    "project.label": context.project.label,
    "knowledge_base.root": context.runtime.knowledgeBaseRoot,
    "knowledge_base.issue_path": context.runtime.issueKnowledgePath,
    "worktree.path": context.runtime.isolatedWorktreePath,
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9._-]+)\s*\}\}/g, (_match, key: string) => {
    return values[key] ?? "";
  });
}
