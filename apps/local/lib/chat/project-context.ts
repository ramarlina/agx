import { type StreamProjectContext, type StreamProjectDetail } from "@/lib/stream-multiplexer";
import { getSQLiteDb } from "@/lib/sqlite-query-adapter";
import { db } from "@/lib/db-instance";
import { buildExecutionProvenance, getProjectSkills, getProjectVariables, getProjectMemory } from "@/lib/db";
import { listResolvedRepoKnowledge } from "@/lib/repo-knowledge";
import { getKnowledgeNote } from "@/lib/knowledge-notes";
import { LOCAL_USER } from "@/lib/auth-mode";
import type { Participant } from "@/lib/types";

const PROJECT_MENTION_PATTERN = /@~project:([a-z0-9][a-z0-9-]*)/gi;

export function normalizeProjectSlug(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().toLowerCase();
}

export function findProjectMentionSlugs(prompt: string): string[] {
  const slugs = new Set<string>();
  for (const match of prompt.matchAll(PROJECT_MENTION_PATTERN)) {
    const slug = normalizeProjectSlug(match[1]);
    if (slug) slugs.add(slug);
  }
  return Array.from(slugs);
}

function toStreamProjectDetail(project: {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  ci_cd_info?: string | null;
  workflow_id?: string | null;
  repos?: Array<{ name: string; path?: string | null; notes?: string | null }>;
}): StreamProjectDetail {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    description: project.description ?? null,
    ciCdInfo: project.ci_cd_info ?? null,
    workflowId: project.workflow_id ?? null,
    repos: (project.repos ?? []).map((repo) => ({
      name: repo.name,
      path: repo.path ?? null,
      notes: repo.notes ?? null,
    })),
  };
}

export async function resolveProjectContext(
  scopedProjectSlug: string,
  mentionedProjectSlugs: string[],
  participants: Participant[] = []
): Promise<StreamProjectContext | undefined> {
  const slugsToFetch = new Set<string>();
  if (scopedProjectSlug) slugsToFetch.add(scopedProjectSlug);
  for (const slug of mentionedProjectSlugs) {
    if (slug) slugsToFetch.add(slug);
  }
  if (slugsToFetch.size === 0) return undefined;

  const rows = await Promise.all(
    Array.from(slugsToFetch).map(async (slug) => {
      try {
        const project = await db.getProjectWithRepos(slug, LOCAL_USER.id);
        return [slug, project] as const;
      } catch (error) {
        console.warn("Failed to load project context", { slug, error });
        return [slug, null] as const;
      }
    })
  );

  const bySlug = new Map<string, NonNullable<(typeof rows)[number][1]>>();
  for (const [slug, row] of rows) {
    if (row) bySlug.set(slug, row);
  }

  const activeProject = scopedProjectSlug ? bySlug.get(scopedProjectSlug) : undefined;
  const mentionedProjects = mentionedProjectSlugs
    .map((slug) => bySlug.get(slug))
    .filter((project): project is NonNullable<typeof project> => Boolean(project))
    .map((project) => toStreamProjectDetail(project));

  if (!activeProject && mentionedProjects.length === 0) {
    return undefined;
  }

  let skills: Array<{ file: string; condition?: string }> | undefined;
  let variables: Array<{ key: string; value: string }> | undefined;
  let memory: Array<{ content: string; source?: string }> | undefined;
  let repoKnowledge: StreamProjectContext["repoKnowledge"];
  let provenanceByAgentId: StreamProjectContext["provenanceByAgentId"];

  if (activeProject) {
    try {
      const [projectSkills, projectVars, projectMem] = await Promise.all([
        getProjectSkills(activeProject.id),
        getProjectVariables(activeProject.id),
        getProjectMemory(activeProject.id, "human"),
      ]);
      const projectSystemNote = getKnowledgeNote("project", activeProject.id);
      if (projectSkills.length > 0) {
        skills = projectSkills.map((skill) => ({
          file: skill.file,
          ...(skill.condition ? { condition: skill.condition } : {}),
        }));
      }
      if (projectVars.length > 0) {
        variables = projectVars.map((variable) => ({ key: variable.key, value: variable.value }));
      }
      if (projectMem.length > 0) {
        memory = projectMem.map((entry) => ({
          content: entry.content,
          ...(entry.source ? { source: entry.source } : {}),
        }));
      }
      if (projectSystemNote?.content) {
        memory = [
          ...(memory ?? []),
          { content: projectSystemNote.content, source: "system-note" },
        ];
      }
      const resolvedRepoKnowledge = listResolvedRepoKnowledge(activeProject.repos ?? []).map((entry) => ({
        repoName: entry.repoName,
        path: entry.path ?? null,
        content: entry.producer === "system" ? `[System-generated] ${entry.content}` : entry.content,
      }));
      if (resolvedRepoKnowledge.length > 0) {
        repoKnowledge = resolvedRepoKnowledge;
      }
      if (participants.length > 0) {
        const sqlite = getSQLiteDb();
        provenanceByAgentId = {};
        for (const participant of participants) {
          const agentMemoryEntries = sqlite
            .prepare(
              "SELECT id, content FROM agent_memory WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20"
            )
            .all(participant.id) as Array<{ id: string; content: string }>;
          provenanceByAgentId[participant.id] = await buildExecutionProvenance(
            participant.id,
            activeProject.id,
            participant.skills ?? [],
            agentMemoryEntries
          );
        }
      }
    } catch (error) {
      console.warn("Failed to load project resources", { projectId: activeProject.id, error });
    }
  }

  return {
    activeProject: activeProject
      ? {
          id: activeProject.id,
          slug: activeProject.slug,
          name: activeProject.name,
        }
      : undefined,
    mentionedProjects: mentionedProjects.length > 0 ? mentionedProjects : undefined,
    skills,
    variables,
    memory,
    repoKnowledge,
    provenanceByAgentId,
  };
}
