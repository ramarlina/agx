import { randomUUID } from "crypto";
import { createAdminDbClient } from "../db-adapter";
import { vaultStore } from "../vault-store";
import {
  generateUniqueProjectSlug,
  getDbClient,
  isMissingRelationError,
} from "./shared";
import {
  validateIdentifierPrefix,
  type Project,
  type ProjectAgent,
  type ProjectInput,
  type ProjectMemory,
  type ProjectRepo,
  type ProjectRepoInput,
  type ProjectSkill,
  type ProjectThread,
  type ProjectUpdatePayload,
  type ProjectVariable,
  type ProjectWithRepos,
  type Task,
  type WorkspaceEntry,
} from "./types";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPOSITORY_WORKSPACE_CATEGORY = "repositories";

async function insertProjectRepos(
  projectId: string,
  repos: ProjectRepoInput[],
  db: any
): Promise<ProjectRepo[]> {
  if (!repos.length) {
    return [];
  }

  const payload = repos.map((repo) => ({
    ...(repo.id ? { id: repo.id } : {}),
    project_id: projectId,
    name: repo.name,
    path: repo.path ?? null,
    git_url: repo.git_url ?? null,
    notes: repo.notes ?? null,
  }));

  const { data, error } = await db.from("project_repos").insert(payload).select("*");
  if (error) {
    if (isMissingRelationError(error, "project_repos")) {
      return [];
    }
    throw error;
  }
  return data || [];
}

function normalizeNullable(value: string | null | undefined): string | null {
  return value ?? null;
}

function repoWorkspacePurpose(repo: Pick<ProjectRepo, "notes">): string | null {
  const notes = repo.notes?.trim();
  return notes || null;
}

function workspaceEntryMatchesRepoLocation(entry: WorkspaceEntry, repo: ProjectRepo): boolean {
  return (
    entry.category === REPOSITORY_WORKSPACE_CATEGORY &&
    entry.name === repo.name &&
    normalizeNullable(entry.path) === normalizeNullable(repo.path)
  );
}

function repoInputMatchesRepo(input: ProjectRepoInput, repo: ProjectRepo): boolean {
  return (
    input.name === repo.name &&
    normalizeNullable(input.path) === normalizeNullable(repo.path) &&
    normalizeNullable(input.git_url) === normalizeNullable(repo.git_url) &&
    normalizeNullable(input.notes) === normalizeNullable(repo.notes)
  );
}

function orderReposLikeInput(repos: ProjectRepo[], inputs: ProjectRepoInput[]): ProjectRepo[] {
  const remaining = repos.slice();
  const ordered: ProjectRepo[] = [];

  for (const input of inputs) {
    const index = input.id
      ? remaining.findIndex((repo) => repo.id === input.id)
      : remaining.findIndex((repo) => repoInputMatchesRepo(input, repo));
    if (index === -1) continue;
    ordered.push(remaining[index]);
    remaining.splice(index, 1);
  }

  return [...ordered, ...remaining];
}

async function syncProjectReposToWorkspaceEntries(
  projectId: string,
  repos: ProjectRepo[],
  db: any,
  previousRepos: ProjectRepo[] = []
): Promise<void> {
  const { data: existingEntries, error: entriesError } = await db
    .from("workspace_entries")
    .select("*")
    .eq("project_id", projectId)
    .eq("category", REPOSITORY_WORKSPACE_CATEGORY);

  if (entriesError) {
    if (isMissingRelationError(entriesError, "workspace_entries")) return;
    throw entriesError;
  }

  const workspaceEntries = ((existingEntries || []) as WorkspaceEntry[]).slice();
  const consumedEntryIds = new Set<string>();
  const previousById = new Map(previousRepos.map((repo) => [repo.id, repo]));

  const claimedEntriesByRepoId = new Map<string, WorkspaceEntry>();
  for (const repo of repos) {
    const previousRepo = previousById.get(repo.id);
    const entry =
      (previousRepo &&
        workspaceEntries.find((candidate) => workspaceEntryMatchesRepoLocation(candidate, previousRepo))) ||
      workspaceEntries.find((candidate) => workspaceEntryMatchesRepoLocation(candidate, repo)) ||
      workspaceEntries.find(
        (candidate) =>
          candidate.category === REPOSITORY_WORKSPACE_CATEGORY &&
          candidate.name === repo.name &&
          !Array.from(claimedEntriesByRepoId.values()).some((claimed) => claimed.id === candidate.id)
      );
    if (entry) claimedEntriesByRepoId.set(repo.id, entry);
  }

  const claimedEntries = Array.from(claimedEntriesByRepoId.entries());
  const originalNamesByEntryId = new Map(claimedEntries.map(([, entry]) => [entry.id, entry.name]));

  for (const [repoId, entry] of claimedEntries) {
    const repo = repos.find((candidate) => candidate.id === repoId);
    if (!repo || entry.name === repo.name) continue;
    const nameConflict = claimedEntries.some(
      ([, candidate]) => candidate.id !== entry.id && originalNamesByEntryId.get(candidate.id) === repo.name
    );
    if (!nameConflict) continue;

    const temporaryName = `__agx_repo_sync_${entry.id}`;
    const { error: updateError } = await db
      .from("workspace_entries")
      .update({
        name: temporaryName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", entry.id)
      .eq("project_id", projectId);
    if (updateError && !isMissingRelationError(updateError, "workspace_entries")) {
      throw updateError;
    }
    entry.name = temporaryName;
  }

  for (const [index, repo] of repos.entries()) {
    const previousRepo = previousById.get(repo.id);
    const claimedEntry = claimedEntriesByRepoId.get(repo.id) ?? null;
    const existingByPrevious = !claimedEntry && previousRepo
      ? workspaceEntries.find(
          (entry) => !consumedEntryIds.has(entry.id) && workspaceEntryMatchesRepoLocation(entry, previousRepo)
        )
      : null;
    const existingByCurrent =
      !claimedEntry &&
      workspaceEntries.find(
        (entry) => !consumedEntryIds.has(entry.id) && workspaceEntryMatchesRepoLocation(entry, repo)
      );
    const nameConflict = workspaceEntries.find(
      (entry) =>
        !consumedEntryIds.has(entry.id) &&
        entry.category === REPOSITORY_WORKSPACE_CATEGORY &&
        entry.name === repo.name
    );
    const existingEntry = claimedEntry || existingByPrevious || existingByCurrent || nameConflict;

    if (existingEntry) {
      consumedEntryIds.add(existingEntry.id);
      const previousPurpose = previousRepo ? repoWorkspacePurpose(previousRepo) : null;
      const currentPurpose = repoWorkspacePurpose(repo);
      const purpose =
        normalizeNullable(existingEntry.purpose) === previousPurpose
          ? currentPurpose
          : existingEntry.purpose ?? currentPurpose;
      const { error: updateError } = await db
        .from("workspace_entries")
        .update({
          name: repo.name,
          path: normalizeNullable(repo.path),
          purpose,
          sort_order: index,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingEntry.id)
        .eq("project_id", projectId);
      if (updateError && !isMissingRelationError(updateError, "workspace_entries")) {
        throw updateError;
      }
      existingEntry.name = repo.name;
      existingEntry.path = normalizeNullable(repo.path);
      existingEntry.purpose = purpose;
      continue;
    }

    const now = new Date().toISOString();
    const { data: inserted, error: insertError } = await db
      .from("workspace_entries")
      .insert({
        id: randomUUID(),
        project_id: projectId,
        category: REPOSITORY_WORKSPACE_CATEGORY,
        name: repo.name,
        path: normalizeNullable(repo.path),
        purpose: repoWorkspacePurpose(repo),
        sort_order: index,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (insertError) {
      if (isMissingRelationError(insertError, "workspace_entries")) return;
      throw insertError;
    }
    if (inserted) workspaceEntries.push(inserted as WorkspaceEntry);
  }
}

export async function getProjects(userId?: string, includeArchived = false): Promise<ProjectWithRepos[]> {
  const db = createAdminDbClient();
  let query = db
    .from("projects")
    .select("*, project_repos(*)");
  if (userId) query = query.eq("user_id", userId);
  if (!includeArchived) query = query.is("archived_at", null);

  const { data, error } = await query;
  if (error) {
    if (isMissingRelationError(error, "projects")) {
      return [];
    }
    throw error;
  }

  const projects = (data || []) as (Project & { project_repos?: ProjectRepo[] })[];
  return projects.map((project) => ({
    ...project,
    repos: project.project_repos ?? [],
  }));
}

export async function getProjectBySlug(slug: string, userId?: string): Promise<Project | null> {
  const db = createAdminDbClient();
  let query = db.from("projects").select("*").eq("slug", slug);
  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query.maybeSingle();
  if (error) {
    if (isMissingRelationError(error, "projects")) {
      return null;
    }
    throw error;
  }
  return data || null;
}

export async function getProjectRepos(projectId: string): Promise<ProjectRepo[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("project_repos")
    .select("*")
    .eq("project_id", projectId);

  if (error) {
    if (isMissingRelationError(error, "project_repos")) {
      return [];
    }
    throw error;
  }

  return data || [];
}

export async function getProjectWithRepos(
  projectIdOrSlug: string,
  userId?: string
): Promise<ProjectWithRepos | null> {
  const db = createAdminDbClient();
  const isUuid = UUID_REGEX.test(projectIdOrSlug);

  let projectQuery = db.from("projects").select("*");
  if (isUuid) {
    projectQuery = projectQuery.eq("id", projectIdOrSlug);
  } else {
    projectQuery = projectQuery.eq("slug", projectIdOrSlug);
  }
  if (userId) projectQuery = projectQuery.eq("user_id", userId);

  const projectResult = await projectQuery.maybeSingle();
  if (projectResult.error) {
    if (isMissingRelationError(projectResult.error, "projects")) {
      return null;
    }
    throw projectResult.error;
  }

  const project = projectResult.data;
  if (!project) return null;

  const repos = await getProjectRepos(project.id);
  return { ...project, repos };
}

export async function createProject(
  userId: string,
  input: ProjectInput,
  dbClient?: any
): Promise<ProjectWithRepos> {
  if (!input.name?.trim()) {
    throw new Error("Project name is required");
  }

  const db = getDbClient(dbClient);
  const baseSlug = input.name.trim() || "project";
  const slug = await generateUniqueProjectSlug(baseSlug, userId, db);

  const identifierPrefix = validateIdentifierPrefix(input.identifier_prefix);

  const payload: Record<string, unknown> = {
    user_id: userId,
    name: input.name.trim(),
    slug,
    description: input.description ?? null,
    workflow_id: input.workflow_id ?? null,
  };
  if (identifierPrefix !== null) {
    payload.identifier_prefix = identifierPrefix;
  }

  let { data: project, error } = await db.from("projects").insert(payload).select("*").single();
  if (error && error.code === "42703") {
    const { identifier_prefix: _ignored, ...fallback } = payload;
    ({ data: project, error } = await db
      .from("projects")
      .insert(fallback)
      .select("*")
      .single());
  }
  if (error) throw error;

  const repos = await insertProjectRepos(project.id, input.repos ?? [], db);
  await syncProjectReposToWorkspaceEntries(project.id, repos, db);

  return { ...project, repos };
}

export async function updateProject(
  projectIdOrSlug: string,
  userId: string,
  updates: ProjectUpdatePayload,
  dbClient?: any
): Promise<ProjectWithRepos | null> {
  const db = getDbClient(dbClient);
  const isUuid = UUID_REGEX.test(projectIdOrSlug);

  let projectId = projectIdOrSlug;
  if (!isUuid) {
    const project = await getProjectBySlug(projectIdOrSlug, userId);
    if (!project) return null;
    projectId = project.id;
  }

  const updatePayload: Record<string, unknown> = {};

  if (typeof updates.name !== "undefined") {
    const trimmedName = updates.name?.trim();
    if (!trimmedName) {
      throw new Error("Project name cannot be empty");
    }
    updatePayload.name = trimmedName;
  }
  if (typeof updates.slug !== "undefined") {
    const trimmedSlug = updates.slug?.trim();
    if (trimmedSlug) {
      updatePayload.slug = trimmedSlug;
    }
  }
  if (typeof updates.description !== "undefined") updatePayload.description = updates.description;
  if (typeof updates.metadata !== "undefined") updatePayload.metadata = updates.metadata;
  if (typeof updates.ci_cd_info !== "undefined") updatePayload.ci_cd_info = updates.ci_cd_info;
  if (typeof updates.workflow_id !== "undefined") updatePayload.workflow_id = updates.workflow_id;
  if (typeof updates.identifier_prefix !== "undefined") {
    updatePayload.identifier_prefix = validateIdentifierPrefix(updates.identifier_prefix);
  }

  if (Object.keys(updatePayload).length) {
    const { error } = await db
      .from("projects")
      .update(updatePayload)
      .eq("id", projectId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  if (typeof updates.repos !== "undefined") {
    const { data: existingRepos, error: existingReposError } = await db
      .from("project_repos")
      .select("*")
      .eq("project_id", projectId);
    if (existingReposError && !isMissingRelationError(existingReposError, "project_repos")) {
      throw existingReposError;
    }

    const existingRepoList = (existingRepos || []) as ProjectRepo[];
    const existingRepoIds = new Set(existingRepoList.map((repo) => repo.id));
    const nextRepoIds = new Set(
      updates.repos.map((repo) => repo.id).filter((repoId): repoId is string => Boolean(repoId))
    );

    for (const existingRepo of existingRepoList) {
      if (nextRepoIds.has(existingRepo.id)) continue;
      const { error: deleteError } = await db
        .from("project_repos")
        .delete()
        .eq("id", existingRepo.id)
        .eq("project_id", projectId);
      if (deleteError && !isMissingRelationError(deleteError, "project_repos")) {
        throw deleteError;
      }
    }

    for (const repo of updates.repos) {
      const payload = {
        name: repo.name,
        path: repo.path ?? null,
        git_url: repo.git_url ?? null,
        notes: repo.notes ?? null,
        project_id: projectId,
      };

      if (repo.id && existingRepoIds.has(repo.id)) {
        const { error: repoUpdateError } = await db
          .from("project_repos")
          .update(payload)
          .eq("id", repo.id)
          .eq("project_id", projectId);
        if (repoUpdateError && !isMissingRelationError(repoUpdateError, "project_repos")) {
          throw repoUpdateError;
        }
        continue;
      }

      const { error: repoInsertError } = await db
        .from("project_repos")
        .insert({
          ...(repo.id ? { id: repo.id } : {}),
          ...payload,
        });
      if (repoInsertError && !isMissingRelationError(repoInsertError, "project_repos")) {
        throw repoInsertError;
      }
    }

    const nextReposResult = await db
      .from("project_repos")
      .select("*")
      .eq("project_id", projectId);
    if (nextReposResult.error && !isMissingRelationError(nextReposResult.error, "project_repos")) {
      throw nextReposResult.error;
    }
    await syncProjectReposToWorkspaceEntries(
      projectId,
      orderReposLikeInput((nextReposResult.data || []) as ProjectRepo[], updates.repos),
      db,
      existingRepoList
    );
  }

  return getProjectWithRepos(projectId, userId);
}

export async function deleteProject(
  projectId: string,
  userId: string,
  dbClient?: any
): Promise<void> {
  const db = getDbClient(dbClient);
  const { error } = await db
    .from("projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("user_id", userId);

  if (error) throw error;
}

export async function assignOrphanTasksToProject(
  projectId: string,
  userId: string,
  dbClient?: any
): Promise<{ updatedCount: number; taskIds: string[] }> {
  const db = getDbClient(dbClient);
  const project = await getProjectWithRepos(projectId, userId);
  if (!project) {
    throw new Error("Project not found");
  }

  const { data: tasks, error: tasksError } = await db
    .from("tasks")
    .select("id, project")
    .eq("user_id", userId)
    .is("project_id", null);

  if (tasksError) throw tasksError;

  const slug = String(project.slug || "").trim().toLowerCase();
  const orphanTaskIds = (tasks || [])
    .filter((task: Task) => {
      const projectValue = String(task.project || "").trim().toLowerCase();
      return !projectValue || projectValue === "none" || projectValue === slug;
    })
    .map((task: Task) => task.id);

  if (!orphanTaskIds.length) {
    return { updatedCount: 0, taskIds: [] };
  }

  const { error: updateError } = await db
    .from("tasks")
    .update({
      project: project.slug,
      project_id: project.id,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .is("project_id", null)
    .in("id", orphanTaskIds);

  if (updateError) throw updateError;

  return { updatedCount: orphanTaskIds.length, taskIds: orphanTaskIds };
}

export async function getProjectAgents(projectId: string): Promise<ProjectAgent[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("project_agents")
    .select("*")
    .eq("project_id", projectId)
    .order("routing_order", { ascending: true });

  if (error) {
    if (isMissingRelationError(error, "project_agents")) return [];
    throw error;
  }
  return data || [];
}

export async function addProjectAgent(
  projectId: string,
  agentId: string,
  routingOrder?: number
): Promise<ProjectAgent> {
  const db = createAdminDbClient();

  if (routingOrder === undefined) {
    const { data: existing } = await db
      .from("project_agents")
      .select("routing_order")
      .eq("project_id", projectId)
      .order("routing_order", { ascending: false })
      .limit(1);
    routingOrder = (existing?.[0]?.routing_order ?? -1) + 1;
  }

  const { data, error } = await db
    .from("project_agents")
    .upsert({ project_id: projectId, agent_id: agentId, routing_order: routingOrder })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function removeProjectAgent(projectId: string, agentId: string): Promise<void> {
  const db = createAdminDbClient();
  const { error } = await db
    .from("project_agents")
    .delete()
    .eq("project_id", projectId)
    .eq("agent_id", agentId);
  if (error) throw error;
}

export async function reorderProjectAgents(
  projectId: string,
  orderedAgentIds: string[]
): Promise<ProjectAgent[]> {
  const db = createAdminDbClient();
  for (let i = 0; i < orderedAgentIds.length; i++) {
    await db
      .from("project_agents")
      .update({ routing_order: i })
      .eq("project_id", projectId)
      .eq("agent_id", orderedAgentIds[i]);
  }
  return getProjectAgents(projectId);
}

export async function getProjectSkills(projectId: string): Promise<ProjectSkill[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("project_skills")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingRelationError(error, "project_skills")) return [];
    throw error;
  }
  return data || [];
}

export async function addProjectSkill(
  projectId: string,
  file: string,
  condition?: string
): Promise<ProjectSkill> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("project_skills")
    .insert({ project_id: projectId, file, condition: condition ?? null })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function removeProjectSkill(skillId: string): Promise<void> {
  const db = createAdminDbClient();
  const { error } = await db.from("project_skills").delete().eq("id", skillId);
  if (error) throw error;
}

export async function getProjectVariables(projectId: string): Promise<ProjectVariable[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("project_variables")
    .select("*")
    .eq("project_id", projectId);

  if (error) {
    if (isMissingRelationError(error, "project_variables")) return [];
    throw error;
  }
  return data || [];
}

export async function setProjectVariable(
  projectId: string,
  key: string,
  value: string
): Promise<ProjectVariable> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("project_variables")
    .upsert({ project_id: projectId, key, value }, { onConflict: "project_id,key" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteProjectVariable(projectId: string, key: string): Promise<void> {
  const db = createAdminDbClient();
  const { error } = await db
    .from("project_variables")
    .delete()
    .eq("project_id", projectId)
    .eq("key", key);
  if (error) throw error;
}

export async function getProjectMemory(
  projectId: string,
  producer?: "human" | "system"
): Promise<ProjectMemory[]> {
  void producer;
  return vaultStore.getProjectMemory(projectId);
}

export async function addProjectMemory(
  projectId: string,
  content: string,
  source?: string,
  producer: "human" | "system" = "human"
): Promise<ProjectMemory> {
  return vaultStore.addProjectMemory(projectId, content, source, producer);
}

export async function deleteProjectMemory(memoryId: string): Promise<void> {
  vaultStore.deleteProjectMemory(memoryId);
}

export async function getProjectThreads(projectId: string): Promise<ProjectThread[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("project_threads")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingRelationError(error, "project_threads")) return [];
    throw error;
  }
  return data || [];
}

export async function addProjectThread(projectId: string, threadId: string): Promise<ProjectThread> {
  const db = createAdminDbClient();
  const { error } = await db
    .from("project_threads")
    .upsert(
      { project_id: projectId, thread_id: threadId },
      { onConflict: "project_id,thread_id", ignoreDuplicates: true }
    );

  if (error) throw error;

  const { data, error: fetchError } = await db
    .from("project_threads")
    .select("*")
    .eq("project_id", projectId)
    .eq("thread_id", threadId)
    .single();

  if (fetchError) throw fetchError;
  return data;
}

export async function removeProjectThread(projectId: string, threadId: string): Promise<void> {
  const db = createAdminDbClient();
  const { error } = await db
    .from("project_threads")
    .delete()
    .eq("project_id", projectId)
    .eq("thread_id", threadId);

  if (error) throw error;
}

export async function getProjectForThread(threadId: string): Promise<string | null> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("project_threads")
    .select("project_id")
    .eq("thread_id", threadId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error, "project_threads")) return null;
    return null;
  }
  return data?.project_id ?? null;
}

export async function getProjectWorkspace(projectId: string): Promise<Record<string, WorkspaceEntry[]>> {
  const entries = await getProjectWorkspaceEntries(projectId);
  return entries.reduce<Record<string, WorkspaceEntry[]>>((acc, entry) => {
    if (!acc[entry.category]) acc[entry.category] = [];
    acc[entry.category].push(entry);
    return acc;
  }, {});
}

export async function getProjectWorkspaceEntries(projectId: string): Promise<WorkspaceEntry[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("workspace_entries")
    .select("*")
    .eq("project_id", projectId)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    if (isMissingRelationError(error, "workspace_entries")) return [];
    throw error;
  }
  return (data || []) as WorkspaceEntry[];
}

export async function createWorkspaceEntry(
  projectId: string,
  entry: { category: string; name: string; path?: string | null; purpose?: string | null; sort_order?: number }
): Promise<WorkspaceEntry> {
  const db = createAdminDbClient();
  const id = randomUUID();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("workspace_entries")
    .insert({
      id,
      project_id: projectId,
      category: entry.category,
      name: entry.name,
      path: entry.path || null,
      purpose: entry.purpose || null,
      sort_order: entry.sort_order ?? 0,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (error) throw error;
  return data as WorkspaceEntry;
}

export async function updateWorkspaceEntry(
  projectId: string,
  entryId: string,
  updates: { name?: string; path?: string | null; purpose?: string | null; sort_order?: number }
): Promise<WorkspaceEntry | null> {
  const db = createAdminDbClient();
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.path !== undefined) payload.path = updates.path;
  if (updates.purpose !== undefined) payload.purpose = updates.purpose;
  if (updates.sort_order !== undefined) payload.sort_order = updates.sort_order;
  payload.updated_at = new Date().toISOString();

  const { data, error } = await db
    .from("workspace_entries")
    .update(payload)
    .eq("id", entryId)
    .eq("project_id", projectId)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data as WorkspaceEntry;
}

export async function deleteWorkspaceEntry(projectId: string, entryId: string): Promise<void> {
  const db = createAdminDbClient();
  const { error } = await db
    .from("workspace_entries")
    .delete()
    .eq("id", entryId)
    .eq("project_id", projectId);
  if (error) throw error;
}

export async function getWorkspaceMapForContext(
  projectId: string
): Promise<{ location: string; path: string | null; purpose: string | null }[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("workspace_entries")
    .select("category, name, path, purpose")
    .eq("project_id", projectId)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    if (isMissingRelationError(error, "workspace_entries")) return [];
    throw error;
  }
  return (data || []).map((row: Record<string, unknown>) => ({
    location: `${row.category}/${row.name}`,
    path: (row.path as string) || null,
    purpose: (row.purpose as string) || null,
  }));
}
