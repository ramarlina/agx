import { vaultStore } from "./vault-store";

export type RepoKnowledgeProducer = "human" | "system";

export interface RepoKnowledgeRow {
  id: string;
  repo_id: string;
  content: string;
  producer: RepoKnowledgeProducer;
  created_at: string;
}

export function listRepoKnowledge(
  repoId: string,
  options?: { producer?: RepoKnowledgeProducer; includeLegacyHumanFallback?: boolean }
): RepoKnowledgeRow[] {
  void options;
  const note = vaultStore.getKnowledgeNote("repo", repoId);
  if (!note?.content.trim()) return [];
  return [{
    id: note.id,
    repo_id: repoId,
    content: note.content,
    producer: "human",
    created_at: note.updatedAt,
  }];
}

export function replaceRepoKnowledge(
  repoId: string,
  producer: RepoKnowledgeProducer,
  content: string
): RepoKnowledgeRow[] {
  const { note } = vaultStore.upsertKnowledgeNote({
    scope: "repo",
    subjectId: repoId,
    content,
    changeSummary: "Repo note updated",
    sourceType: producer === "system" ? "task_completion" : "manual",
    sourceId: producer === "system" ? "system-repo-note" : "manual-repo-note",
    metadata: { producer },
  });
  return [{
    id: note.id,
    repo_id: repoId,
    content: note.content,
    producer,
    created_at: note.updatedAt,
  }];
}

export function listResolvedRepoKnowledge(
  repos: Array<{ id?: string; name: string; path?: string | null; notes?: string | null }>
): Array<{
  repoId: string;
  repoName: string;
  path?: string | null;
  content: string;
  producer: RepoKnowledgeProducer;
}> {
  const resolved: Array<{
    repoId: string;
    repoName: string;
    path?: string | null;
    content: string;
    producer: RepoKnowledgeProducer;
  }> = [];

  for (const repo of repos) {
    if (!repo.id) {
      const fallback = String(repo.notes ?? "").trim();
      if (!fallback) continue;
      resolved.push({
        repoId: "",
        repoName: repo.name,
        path: repo.path ?? null,
        content: fallback,
        producer: "human",
      });
      continue;
    }

    const note = vaultStore.getKnowledgeNote("repo", repo.id);
    const content = note?.content.trim() || String(repo.notes ?? "").trim();
    if (!content) continue;
    resolved.push({
      repoId: repo.id,
      repoName: repo.name,
      path: repo.path ?? null,
      content,
      producer: "human",
    });
  }

  return resolved;
}
