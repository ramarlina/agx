import * as path from "path";

export type SuggestionMatch = "basename" | "segment" | "none";

export interface SuggestedRepo {
  path: string;
  basename: string;
  matchedOn: SuggestionMatch;
  hasGit: true;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Score a single repo path against the project slug/name.
 *
 * Returns:
 *   { matchedOn: "basename", score: 3 } when basename equals slug or name (case-insensitive)
 *   { matchedOn: "segment",  score: 2 } when basename includes either as substring
 *   { matchedOn: "segment",  score: 1 } when any other path segment includes either
 *   null                                  when no match (and at least one term provided)
 *
 * If neither slug nor name is provided, returns { matchedOn: "none", score: 0 } so
 * the caller can include all repos.
 */
export function scoreRepoMatch(
  repoPath: string,
  projectSlug?: string | null,
  projectName?: string | null,
): { matchedOn: SuggestionMatch; score: number } | null {
  const slug = normalize(projectSlug);
  const name = normalize(projectName);
  const terms = [slug, name].filter((t) => t.length > 0);

  if (terms.length === 0) {
    return { matchedOn: "none", score: 0 };
  }

  const segments = repoPath.split(path.sep).filter((s) => s.length > 0);
  const basename = segments.length > 0 ? segments[segments.length - 1] : "";
  const basenameLower = basename.toLowerCase();

  // Exact basename match wins
  if (terms.some((t) => basenameLower === t)) {
    return { matchedOn: "basename", score: 3 };
  }

  // Substring match on basename
  if (terms.some((t) => basenameLower.includes(t))) {
    return { matchedOn: "segment", score: 2 };
  }

  // Substring match on any other segment
  const otherSegments = segments.slice(0, -1).map((s) => s.toLowerCase());
  if (otherSegments.some((seg) => terms.some((t) => seg.includes(t)))) {
    return { matchedOn: "segment", score: 1 };
  }

  return null;
}

/**
 * Filter, score, and sort indexed repo paths against a project slug / name.
 * Tie-breaks higher scores first; on ties, shorter paths first; then lexicographic.
 */
export function suggestRepos(
  repoPaths: readonly string[],
  opts: { projectSlug?: string | null; projectName?: string | null; limit?: number } = {},
): SuggestedRepo[] {
  const { projectSlug, projectName, limit } = opts;

  const scored: Array<{ repo: SuggestedRepo; score: number }> = [];
  for (const repoPath of repoPaths) {
    const result = scoreRepoMatch(repoPath, projectSlug, projectName);
    if (!result) continue;
    const segments = repoPath.split(path.sep).filter((s) => s.length > 0);
    const basename = segments.length > 0 ? segments[segments.length - 1] : repoPath;
    scored.push({
      repo: {
        path: repoPath,
        basename,
        matchedOn: result.matchedOn,
        hasGit: true,
      },
      score: result.score,
    });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.repo.path.length !== b.repo.path.length) {
      return a.repo.path.length - b.repo.path.length;
    }
    return a.repo.path.localeCompare(b.repo.path);
  });

  const out = scored.map((s) => s.repo);
  if (typeof limit === "number" && limit >= 0) {
    return out.slice(0, limit);
  }
  return out;
}
