/**
 * Types for the file @mention feature
 */

/**
 * Lightweight manifest for a folder — one level deep only.
 * Returned alongside folder suggestions to give callers enough
 * context without injecting a full recursive tree.
 */
export interface FolderManifest {
  /** Total number of direct children (files + subdirectories) */
  childCount: number;
  /** Human-readable total size of direct file children (e.g. "1.2 MB") */
  sizeSummary: string;
  /** Direct children with name, type, and optional size */
  children: Array<{ name: string; type: "file" | "folder"; size?: number }>;
}

export interface FileSuggestion {
  /** Absolute path to the file/folder */
  path: string;
  /** Path relative to the search root */
  relativePath: string;
  /** File or folder */
  type: "file" | "folder";
  /** File size in bytes (files only) */
  size?: number;
  /** Last modified timestamp (ms since epoch) */
  modifiedAt?: number;
  /** Lightweight manifest for folder suggestions (populated by /api/file-search) */
  manifest?: FolderManifest;
}

export interface WorkspaceRoot {
  /** Absolute path to the workspace root */
  path: string;
  /** Display name (e.g., "Code", "Projects") */
  name?: string;
  /** Whether this root is user-configured or auto-detected */
  source: "user" | "auto";
}

export interface FileSearchResult {
  files: FileSuggestion[];
  /** Whether there are more results available */
  hasMore: boolean;
  /** The root that was used for the search */
  usedRoot: string;
  /** Total matches found (before limit) */
  total: number;
}

export interface FileSearchQuery {
  /** Search query (path prefix or fuzzy match) */
  query: string;
  /** Override the default workspace root */
  root?: string;
  /** Maximum results to return */
  limit?: number;
  /** Include folders in results */
  includeFolders?: boolean;
}

/** Default ignore patterns for file search */
export const DEFAULT_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  ".cache",
  "*.cache",
  "Library",
  ".Trash",
  ".DS_Store",
  "dist",
  "build",
  ".next",
  "__pycache__",
  "*.pyc",
  ".venv",
  "venv",
  ".env",
  "*.log",
] as const;