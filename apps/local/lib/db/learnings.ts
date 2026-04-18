import { createAdminDbClient } from "../db-adapter";
import { vaultStore } from "../vault-store";
import { getProjectWithRepos } from "./projects";
import type { Learning, LearningScope } from "./types";

export async function getLearnings(
  scope: LearningScope,
  scopeId?: string,
  userId?: string
): Promise<Learning[]> {
  if (scope !== "task") {
    return vaultStore.getLearnings(scope, scopeId);
  }
  const db = createAdminDbClient();

  let query = db
    .from("learnings")
    .select("*")
    .eq("scope", scope)
    .order("created_at", { ascending: false });

  if (scopeId) query = query.eq("scope_id", scopeId);
  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function addLearning(
  scope: LearningScope,
  content: string,
  scopeId?: string,
  userId?: string
): Promise<Learning> {
  if (scope !== "task") {
    return vaultStore.addLearning(scope, content, scopeId);
  }
  const db = createAdminDbClient();

  const { data, error } = await db
    .from("learnings")
    .insert({ scope, scope_id: scopeId, content, user_id: userId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteLearning(id: string, userId?: string): Promise<void> {
  if (id === "global-playbook") {
    vaultStore.deleteLearning(id, "global");
    return;
  }
  const project = await getProjectWithRepos(id, userId);
  if (project) {
    vaultStore.deleteLearning(id, "project", project.id);
    return;
  }
  const db = createAdminDbClient();
  let query = db.from("learnings").delete().eq("id", id);
  if (userId) query = query.eq("user_id", userId);
  const { error } = await query;
  if (error) throw error;
}

