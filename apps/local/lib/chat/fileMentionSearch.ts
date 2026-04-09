/**
 * Client-side fuzzy file mention search utility.
 *
 * Wraps the /api/file-search endpoint with fuzzy scoring and recency ranking.
 * Intended for use in composer hooks (useFileMentionSearch) — runs in the browser.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileSearchResult {
  /** Absolute path to the file or folder */
  path: string;
  /** 'file' or 'folder' */
  type: "file" | "folder";
  /** Path relative to the search root */
  relativePath: string;
  /** Last modified timestamp (ms since epoch), if available */
  lastModified?: number;
}

export interface FileMentionSearchOptions {
  /** Maximum results to return (default: 10) */
  limit?: number;
  /** Override the search root directory */
  root?: string;
  /** Whether to include folders in results (default: true) */
  includeFolders?: boolean;
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

/**
 * Score a file basename against a query string.
 * Returns: 2 = prefix match, 1 = substring match, 0.5 = fuzzy match, 0 = no match.
 */
export function scoreFuzzy(name: string, query: string): number {
  if (!query) return 0;
  const lname = name.toLowerCase();
  const lquery = query.toLowerCase();

  if (lname.startsWith(lquery)) return 2;
  if (lname.includes(lquery)) return 1;

  // Fuzzy: all query chars appear in name in order
  let qi = 0;
  for (let i = 0; i < lname.length && qi < lquery.length; i++) {
    if (lname[i] === lquery[qi]) qi++;
  }
  return qi === lquery.length ? 0.5 : 0;
}

/**
 * Recency bonus: 0–1, linearly decaying to 0 over one week.
 */
export function recencyBonus(lastModifiedMs: number | undefined): number {
  if (!lastModifiedMs) return 0;
  const ageMs = Date.now() - lastModifiedMs;
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.max(0, 1 - ageMs / oneWeek);
}

/**
 * Rank file search results by fuzzy score + recency.
 * Results with a score of 0 are excluded when a query is present.
 */
export function rankResults(
  results: FileSearchResult[],
  query: string
): FileSearchResult[] {
  if (!query) return results;

  const baseName = (r: FileSearchResult) =>
    r.relativePath.split("/").pop() ?? r.relativePath;

  return results
    .map((r) => ({
      result: r,
      score: scoreFuzzy(baseName(r), query) + recencyBonus(r.lastModified),
    }))
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.result.lastModified ?? 0) - (a.result.lastModified ?? 0)
    )
    .map((r) => r.result);
}

// ─── Search function ──────────────────────────────────────────────────────────

/**
 * Fetch and rank file/folder results from /api/file-search.
 *
 * @param query   - User-typed query (after @/)
 * @param options - Optional limit, root, includeFolders
 * @param signal  - AbortSignal for cancellation
 */
export async function fetchFileMentionResults(
  query: string,
  options: FileMentionSearchOptions = {},
  signal?: AbortSignal
): Promise<FileSearchResult[]> {
  const { limit = 10, root, includeFolders = true } = options;

  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    includeFolders: String(includeFolders),
  });
  if (root) params.set("root", root);

  const res = await fetch(`/api/file-search?${params.toString()}`, { signal });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    files: Array<{
      path: string;
      type: "file" | "folder";
      relativePath: string;
      modifiedAt?: number;
    }>;
  };

  const results: FileSearchResult[] = data.files.map((f) => ({
    path: f.path,
    type: f.type,
    relativePath: f.relativePath,
    lastModified: f.modifiedAt,
  }));

  // Re-rank client-side to apply consistent fuzzy scoring
  return rankResults(results, query);
}
