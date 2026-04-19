import type { WorkspaceEntry } from "@/lib/db/types";
import {
  DEFAULT_WORKSPACE_CATEGORIES,
  getWorkspaceCategory,
  WORKSPACE_CATEGORY_IDS,
} from "@/lib/workspace-categories";

export type ProjectWorkspace = Record<string, WorkspaceEntry[]>;

export interface WorkspaceCategoryGroup {
  id: string;
  label: string;
  entries: WorkspaceEntry[];
  isPreset: boolean;
  isEmpty: boolean;
}

export function isPresetWorkspaceCategory(category: string): boolean {
  return WORKSPACE_CATEGORY_IDS.includes(category as (typeof WORKSPACE_CATEGORY_IDS)[number]);
}

export function formatWorkspaceCategoryLabel(category: string): string {
  const trimmed = category.trim();
  const preset = trimmed ? getWorkspaceCategory(trimmed as (typeof WORKSPACE_CATEGORY_IDS)[number]) : null;
  if (preset) return preset.label;
  if (!trimmed) return "Custom";

  return trimmed
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function sortEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries].sort((left, right) => {
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order;
    }
    return left.name.localeCompare(right.name);
  });
}

export function countWorkspaceEntries(workspace: ProjectWorkspace): number {
  return Object.values(workspace).reduce((total, entries) => total + entries.length, 0);
}

export function buildWorkspaceCategoryGroups(
  workspace: ProjectWorkspace,
  extraCategories: string[] = [],
): WorkspaceCategoryGroup[] {
  const presetGroups: WorkspaceCategoryGroup[] = DEFAULT_WORKSPACE_CATEGORIES.map((category) => {
    const entries = sortEntries(workspace[category.id] ?? []);
    return {
      id: category.id,
      label: category.label,
      entries,
      isPreset: true,
      isEmpty: entries.length === 0,
    };
  });

  const customCategoryIds = [...new Set([...Object.keys(workspace), ...extraCategories])]
    .map((category) => category.trim())
    .filter((category) => category.length > 0)
    .filter((category) => !isPresetWorkspaceCategory(category))
    .sort((left, right) => formatWorkspaceCategoryLabel(left).localeCompare(formatWorkspaceCategoryLabel(right)));

  const customGroups: WorkspaceCategoryGroup[] = customCategoryIds.map((category) => {
    const entries = sortEntries(workspace[category] ?? []);
    return {
      id: category,
      label: formatWorkspaceCategoryLabel(category),
      entries,
      isPreset: false,
      isEmpty: entries.length === 0,
    };
  });

  return [...presetGroups, ...customGroups];
}
