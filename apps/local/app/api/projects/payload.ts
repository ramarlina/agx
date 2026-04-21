import type { ProjectInput, ProjectRepoInput, ProjectUpdatePayload } from "@/lib/db-adapter.interface";

export class InvalidProjectPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProjectPayloadError";
  }
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim();
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function parseProjectRepos(value: unknown): ProjectRepoInput[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const repos: ProjectRepoInput[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;

    const rawName = (item as Record<string, unknown>).name;
    const rawPath = (item as Record<string, unknown>).path;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const path = typeof rawPath === "string" ? rawPath.trim() : "";

    if (!name && !path) return;
    if (!name) {
      throw new InvalidProjectPayloadError(
        `Folder name is required for repos[${index}] when a local path is provided`
      );
    }
    if (!path) {
      throw new InvalidProjectPayloadError(
        `Local path is required for repos[${index}] when a folder name is provided`
      );
    }

    const repo: Partial<ProjectRepoInput> = { name };
    const rawId = (item as Record<string, unknown>).id;
    const rawGitUrl = (item as Record<string, unknown>).git_url;
    const rawNotes = (item as Record<string, unknown>).notes;

    if (typeof rawId === "string" && rawId.trim()) {
      repo.id = rawId.trim();
    }

    repo.path = path;

    if (typeof rawGitUrl === "string" && rawGitUrl.trim()) {
      repo.git_url = rawGitUrl.trim();
    }

    if (typeof rawNotes === "string") {
      const trimmed = rawNotes.trim();
      if (trimmed) repo.notes = trimmed;
    }

    repos.push(repo as ProjectRepoInput);
  });

  return repos;
}

function parseIdentifierPrefix(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

export function buildProjectInput(body: Record<string, unknown>): ProjectInput {
  const input: ProjectInput = {
    name: String(body.name ?? "").trim(),
    description: typeof body.description === "string" ? body.description.trim() : undefined,
    repos: parseProjectRepos(body.repos),
  };
  if (Object.prototype.hasOwnProperty.call(body, "identifier_prefix")) {
    const prefix = parseIdentifierPrefix(body.identifier_prefix);
    if (prefix !== undefined) {
      input.identifier_prefix = prefix;
    }
  }
  return input;
}

export function buildProjectUpdatePayload(body: Record<string, unknown>): ProjectUpdatePayload {
  const payload: ProjectUpdatePayload = {};

  if (typeof body.name === "string") {
    payload.name = body.name.trim();
  }
  if (typeof body.slug === "string") {
    payload.slug = body.slug.trim();
  }
  if (typeof body.description === "string") {
    payload.description = body.description.trim();
  } else if (body.description === null) {
    payload.description = null;
  }
  if (body.metadata !== undefined) {
    payload.metadata = parseMetadata(body.metadata);
  }
  if (typeof body.ci_cd_info === "string") {
    payload.ci_cd_info = body.ci_cd_info.trim() || null;
  } else if (body.ci_cd_info === null) {
    payload.ci_cd_info = null;
  }
  if (typeof body.workflow_id === "string") {
    payload.workflow_id = body.workflow_id.trim() || null;
  } else if (body.workflow_id === null) {
    payload.workflow_id = null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "repos")) {
    const normalizedRepos = parseProjectRepos(body.repos);
    payload.repos = normalizedRepos ?? [];
  }
  if (Object.prototype.hasOwnProperty.call(body, "identifier_prefix")) {
    const prefix = parseIdentifierPrefix(body.identifier_prefix);
    if (prefix !== undefined) {
      payload.identifier_prefix = prefix;
    }
  }

  return payload;
}
