// ---------------------------------------------------------------------------
// Preset workspace categories — suggestions for the workspace map empty state
// ---------------------------------------------------------------------------

export const WORKSPACE_CATEGORY_IDS = [
  "repositories",
  "docs",
  "config",
  "scripts",
] as const;

export type WorkspaceCategoryId = (typeof WORKSPACE_CATEGORY_IDS)[number];

export interface WorkspaceCategory {
  id: WorkspaceCategoryId;
  label: string;
  icon: string;
}

const categoriesData: WorkspaceCategory[] = [
  { id: "repositories", label: "Repositories", icon: "GitBranch" },
  { id: "docs", label: "Docs", icon: "FileText" },
  { id: "config", label: "Config", icon: "Settings" },
  { id: "scripts", label: "Scripts", icon: "Terminal" },
];

export const DEFAULT_WORKSPACE_CATEGORIES: WorkspaceCategory[] = categoriesData.map((c) => ({ ...c }));

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

const categoryMap = new Map<WorkspaceCategoryId, WorkspaceCategory>(
  categoriesData.map((c) => [c.id, c]),
);

export function getWorkspaceCategory(id: WorkspaceCategoryId): WorkspaceCategory | null {
  const c = categoryMap.get(id);
  return c ? { ...c } : null;
}

export function listWorkspaceCategories(): WorkspaceCategory[] {
  return categoriesData.map((c) => ({ ...c }));
}
