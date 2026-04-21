"use client";

export interface ProjectRepoDraftLike {
  name: string;
  path: string;
}

export type ProjectRepoValidationIssue = "missing_name" | "missing_path";

export interface InvalidProjectRepoDraft<T extends ProjectRepoDraftLike = ProjectRepoDraftLike> {
  index: number;
  issue: ProjectRepoValidationIssue;
  repo: T;
}

function trimRepoFields(repo: ProjectRepoDraftLike) {
  return {
    name: repo.name.trim(),
    path: repo.path.trim(),
  };
}

export function getProjectRepoValidationIssue(
  repo: ProjectRepoDraftLike
): ProjectRepoValidationIssue | null {
  const { name, path } = trimRepoFields(repo);

  if (!name && !path) {
    return null;
  }
  if (!name) {
    return "missing_name";
  }
  if (!path) {
    return "missing_path";
  }
  return null;
}

export function findInvalidProjectRepoDraft<T extends ProjectRepoDraftLike>(
  repos: T[]
): InvalidProjectRepoDraft<T> | null {
  for (const [index, repo] of repos.entries()) {
    const issue = getProjectRepoValidationIssue(repo);
    if (issue) {
      return { index, issue, repo };
    }
  }
  return null;
}

export function isCompleteProjectRepoDraft(repo: ProjectRepoDraftLike): boolean {
  const { name, path } = trimRepoFields(repo);
  return Boolean(name && path);
}

export function formatInvalidProjectRepoDraftMessage(
  invalidRepo: InvalidProjectRepoDraft
): string {
  const { issue, repo } = invalidRepo;
  if (issue === "missing_name") {
    return `Folder name is required for local path "${repo.path.trim()}"`;
  }
  return `Local path is required for folder "${repo.name.trim()}"`;
}
