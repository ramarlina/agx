import "server-only";

import { constants } from "fs";
import { access, stat } from "fs/promises";
import path from "path";
import type { ProjectRepo, ProjectRepoInput } from "@/lib/db-adapter.interface";

export class InvalidProjectRepoPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProjectRepoPathError";
  }
}

interface ProjectRepoPathValidationTarget {
  repo: ProjectRepoInput;
  index: number;
}

function pathLabel(repoPath: string) {
  return repoPath.trim() || "(blank)";
}

function resolveLocalPath(repoPath: string) {
  return path.resolve(repoPath.replace(/^~/, process.env.HOME ?? "~"));
}

export function filterReposRequiringPathValidation(
  repos: ProjectRepoInput[] | undefined,
  existingRepos: ProjectRepo[]
): ProjectRepoPathValidationTarget[] | undefined {
  if (!repos?.length) return undefined;

  const existingPaths = new Map(
    existingRepos.map((repo) => [repo.id, repo.path?.trim() ?? ""])
  );

  return repos.map((repo, index) => ({ repo, index })).filter(({ repo }) => {
    if (!repo.id) return true;
    return existingPaths.get(repo.id) !== (repo.path?.trim() ?? "");
  });
}

function toValidationTargets(
  repos: ProjectRepoInput[] | ProjectRepoPathValidationTarget[] | undefined
): ProjectRepoPathValidationTarget[] {
  if (!repos?.length) return [];
  if ("repo" in repos[0]) return repos as ProjectRepoPathValidationTarget[];
  return (repos as ProjectRepoInput[]).map((repo, index) => ({ repo, index }));
}

export async function validateProjectRepoPaths(
  repos: ProjectRepoInput[] | ProjectRepoPathValidationTarget[] | undefined
): Promise<void> {
  const targets = toValidationTargets(repos);
  if (!targets?.length) return;

  for (const { repo, index } of targets) {
    const rawPath = repo.path?.trim();
    if (!rawPath) continue;

    const resolvedPath = resolveLocalPath(rawPath);
    let info;
    try {
      info = await stat(resolvedPath);
    } catch {
      throw new InvalidProjectRepoPathError(
        `Folder path does not exist for repos[${index}]: ${pathLabel(rawPath)}`
      );
    }

    if (!info.isDirectory()) {
      throw new InvalidProjectRepoPathError(
        `Folder path is not a directory for repos[${index}]: ${pathLabel(rawPath)}`
      );
    }

    try {
      await access(resolvedPath, constants.R_OK | constants.X_OK);
    } catch {
      throw new InvalidProjectRepoPathError(
        `Folder path is not readable for repos[${index}]: ${pathLabel(rawPath)}`
      );
    }
  }
}
