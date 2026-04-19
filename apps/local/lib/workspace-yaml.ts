import { dump, load } from "js-yaml";
import type { WorkspaceEntry } from "./db";
import { listWorkspaceCategories } from "./workspace-categories";

export interface WorkspaceYamlCategory {
  id: string;
  label: string;
}

export interface WorkspaceYamlEntry {
  category: string;
  name: string;
  purpose: string | null;
}

export interface WorkspaceYamlDocument {
  version: 1;
  categories: WorkspaceYamlCategory[];
  entries: WorkspaceYamlEntry[];
}

const knownCategoryLabels = new Map<string, string>(
  listWorkspaceCategories().map((category) => [category.id, category.label]),
);

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid or missing '${field}'`);
  }

  return value.trim();
}

function normalizeOptionalPurpose(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`Invalid '${field}'`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function fallbackCategoryLabel(categoryId: string): string {
  return categoryId
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || categoryId;
}

function categoryKey(category: string, name: string): string {
  return `${category}\u0000${name}`;
}

export function serializeWorkspace(entries: WorkspaceEntry[]): string {
  const sortedEntries = [...entries].sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.name.localeCompare(b.name);
  });

  const categories = new Map<string, WorkspaceYamlCategory>();
  for (const entry of sortedEntries) {
    if (!categories.has(entry.category)) {
      categories.set(entry.category, {
        id: entry.category,
        label: knownCategoryLabels.get(entry.category) ?? fallbackCategoryLabel(entry.category),
      });
    }
  }

  const doc: WorkspaceYamlDocument = {
    version: 1,
    categories: Array.from(categories.values()),
    entries: sortedEntries.map((entry) => ({
      category: entry.category,
      name: entry.name,
      purpose: entry.purpose ?? null,
    })),
  };

  return dump(doc, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
}

export function deserializeWorkspace(yaml: string): WorkspaceYamlDocument {
  const parsed = load(yaml);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid YAML: expected an object at the root level");
  }

  const doc = parsed as Record<string, unknown>;
  if (doc.version !== 1) {
    throw new Error(`Unsupported version: ${doc.version ?? "missing"}. Only version 1 is supported.`);
  }
  if (!Array.isArray(doc.categories)) {
    throw new Error("Invalid YAML: missing or invalid 'categories' array");
  }
  if (!Array.isArray(doc.entries)) {
    throw new Error("Invalid YAML: missing or invalid 'entries' array");
  }

  const seenCategories = new Set<string>();
  const categories = doc.categories.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid category entry at index ${index}`);
    }

    const category = entry as Record<string, unknown>;
    const id = normalizeRequiredString(category.id, `categories[${index}].id`);
    const label = normalizeRequiredString(category.label, `categories[${index}].label`);

    if (seenCategories.has(id)) {
      throw new Error(`Duplicate category id '${id}'`);
    }
    seenCategories.add(id);

    return { id, label };
  });

  const categoryIds = new Set(categories.map((category) => category.id));
  const seenEntries = new Set<string>();

  const entries = doc.entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid workspace entry at index ${index}`);
    }

    const workspaceEntry = entry as Record<string, unknown>;
    if ("path" in workspaceEntry) {
      throw new Error(`Invalid workspace entry at index ${index}: 'path' is not allowed`);
    }

    const category = normalizeRequiredString(workspaceEntry.category, `entries[${index}].category`);
    const name = normalizeRequiredString(workspaceEntry.name, `entries[${index}].name`);
    const purpose = normalizeOptionalPurpose(workspaceEntry.purpose, `entries[${index}].purpose`);

    if (!categoryIds.has(category)) {
      throw new Error(`Entry '${name}' references unknown category '${category}'`);
    }

    const key = categoryKey(category, name);
    if (seenEntries.has(key)) {
      throw new Error(`Duplicate workspace entry '${category}/${name}'`);
    }
    seenEntries.add(key);

    return { category, name, purpose };
  });

  return {
    version: 1,
    categories,
    entries,
  };
}
