import { realpath, stat } from "fs/promises";
import { homedir } from "os";
import { join, relative, resolve, dirname, basename } from "path";
import {
  FileSuggestion,
  FileSearchResult,
  FileSearchQuery,
  DEFAULT_IGNORE_PATTERNS,
} from "@/types/fileMention";

/**
 * Security boundary enforcement for file access.
 * Prevents path traversal and symlink escape attacks.
 */

const HOME = homedir();

/**
 * Expand `~` to the user's home directory
 */
export function expandHome(path: string): string {
  if (path === "~" || path.startsWith("~/")) {
    return join(HOME, path.slice(1));
  }
  return path;
}

/**
 * Resolve a path to its canonical absolute form.
 * Returns null if the path doesn't exist or can't be resolved.
 */
async function safeResolve(path: string): Promise<string | null> {
  try {
    const expanded = expandHome(path);
    const resolved = resolve(expanded);
    // realpath follows symlinks and returns the canonical path
    const real = await realpath(resolved);
    return real;
  } catch {
    return null;
  }
}

/**
 * Check if a resolved path is under an allowed root.
 * Both paths must be resolved (realpath) before calling.
 */
function isUnderRoot(resolvedPath: string, resolvedRoot: string): boolean {
  // Normalize with trailing slash for proper prefix matching
  const normalizedRoot = resolvedRoot.endsWith("/")
    ? resolvedRoot
    : resolvedRoot + "/";
  const normalizedPath = resolvedPath.endsWith("/")
    ? resolvedPath
    : resolvedPath + "/";

  return normalizedPath.startsWith(normalizedRoot);
}

/**
 * Validate that a search path is within allowed boundaries.
 * Returns the resolved root if valid, throws if not.
 */
export async function validateSearchRoot(
  requestedRoot: string | undefined,
  allowedRoots: string[],
  homeSearchConsent: boolean
): Promise<string> {
  // If no root specified, use first allowed root or home (with consent)
  if (!requestedRoot) {
    if (allowedRoots.length > 0) {
      const resolved = await safeResolve(allowedRoots[0]);
      if (resolved) return resolved;
    }
    if (homeSearchConsent) {
      return HOME;
    }
    throw new Error(
      "No workspace root configured. Add a workspace root or enable home directory search in settings."
    );
  }

  // Expand and resolve the requested root
  const resolvedRequested = await safeResolve(requestedRoot);
  if (!resolvedRequested) {
    throw new Error(`Path does not exist: ${requestedRoot}`);
  }

  // Check against allowed roots
  for (const allowed of allowedRoots) {
    const resolvedAllowed = await safeResolve(allowed);
    if (resolvedAllowed && isUnderRoot(resolvedRequested, resolvedAllowed)) {
      return resolvedRequested;
    }
  }

  // Check if it's under home (with consent)
  if (homeSearchConsent && isUnderRoot(resolvedRequested, HOME)) {
    return resolvedRequested;
  }

  throw new Error(
    `Path "${requestedRoot}" is not within an allowed workspace root.`
  );
}

/**
 * Search for files matching a query pattern.
 * Uses fast-glob for efficient filesystem walking.
 */
export async function searchFiles(
  query: FileSearchQuery,
  allowedRoots: string[],
  homeSearchConsent: boolean,
  ignorePatterns: string[] = [...DEFAULT_IGNORE_PATTERNS]
): Promise<FileSearchResult> {
  // Dynamic import for fast-glob (ESM)
  const { glob } = await import("fast-glob");

  const limit = query.limit ?? 50;
  const validatedRoot = await validateSearchRoot(
    query.root,
    allowedRoots,
    homeSearchConsent
  );

  // Build the search pattern
  const searchTerm = query.query || "";
  const searchPattern = searchTerm.includes("*")
    ? searchTerm
    : `**/*${searchTerm}*`;

  // Run the search
  const entries = await glob(searchPattern, {
    cwd: validatedRoot,
    onlyFiles: !query.includeFolders,
    ignore: ignorePatterns,
    absolute: true,
    stats: true,
    suppressErrors: true,
    followSymbolicLinks: false, // Security: don't follow symlinks
  });

  // Process and rank results
  const files: FileSuggestion[] = await Promise.all(
    entries.slice(0, limit).map(async (entry) => {
      const stats = "stats" in entry ? entry.stats : null;
      const isFile = stats?.isFile() ?? true;

      return {
        path: entry.path,
        relativePath: relative(validatedRoot, entry.path),
        type: isFile ? "file" : "folder",
        size: stats?.size,
        modifiedAt: stats?.mtimeMs,
      };
    })
  );

  // Sort by recency (most recent first)
  files.sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0));

  return {
    files,
    hasMore: entries.length > limit,
    usedRoot: validatedRoot,
    total: entries.length,
  };
}

/**
 * Get a list of suggested top-level directories under a root.
 * Useful when the query is short/ambiguous.
 */
export async function getRootSuggestions(
  root: string,
  ignorePatterns: string[] = [...DEFAULT_IGNORE_PATTERNS]
): Promise<FileSuggestion[]> {
  const { glob } = await import("fast-glob");

  const entries = await glob("*", {
    cwd: root,
    onlyFiles: false,
    ignore: ignorePatterns,
    absolute: true,
    stats: true,
    suppressErrors: true,
    followSymbolicLinks: false,
  });

  const suggestions: FileSuggestion[] = await Promise.all(
    entries.map(async (entry) => {
      const stats = "stats" in entry ? entry.stats : null;

      return {
        path: entry.path,
        relativePath: basename(entry.path),
        type: stats?.isDirectory() ? "folder" : "file",
        size: stats?.size,
        modifiedAt: stats?.mtimeMs,
      };
    })
  );

  // Folders first, then by name
  suggestions.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    return a.relativePath.localeCompare(b.relativePath);
  });

  return suggestions;
}

/**
 * Read the contents of a file for context injection.
 * Validates the file path is within allowed boundaries.
 */
export async function readFileForContext(
  filePath: string,
  allowedRoots: string[],
  homeSearchConsent: boolean,
  maxSize: number = 100_000 // 100KB default limit
): Promise<{ content: string; path: string; size: number }> {
  const { readFile } = await import("fs/promises");

  const resolved = await safeResolve(filePath);
  if (!resolved) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  // Validate access
  await validateSearchRoot(dirname(resolved), allowedRoots, homeSearchConsent);

  // Check file stats
  const stats = await stat(resolved);
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }
  if (stats.size > maxSize) {
    throw new Error(
      `File too large (${Math.round(stats.size / 1024)}KB). Maximum size is ${Math.round(maxSize / 1024)}KB.`
    );
  }

  const content = await readFile(resolved, "utf-8");
  return {
    content,
    path: resolved,
    size: stats.size,
  };
}