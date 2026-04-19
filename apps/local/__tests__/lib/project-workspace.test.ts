import type { WorkspaceEntry } from "@/lib/db/types";
import {
  buildWorkspaceCategoryGroups,
  countWorkspaceEntries,
  formatWorkspaceCategoryLabel,
} from "@/lib/project-workspace";

function createEntry(overrides: Partial<WorkspaceEntry>): WorkspaceEntry {
  return {
    id: overrides.id ?? "entry-1",
    project_id: overrides.project_id ?? "project-1",
    category: overrides.category ?? "repositories",
    name: overrides.name ?? "backend",
    path: overrides.path ?? "/tmp/backend",
    purpose: overrides.purpose ?? "Backend service",
    sort_order: overrides.sort_order ?? 0,
    created_at: overrides.created_at ?? "2026-04-19T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-04-19T00:00:00.000Z",
  };
}

describe("project-workspace helpers", () => {
  test("keeps preset categories first and appends custom categories alphabetically", () => {
    const groups = buildWorkspaceCategoryGroups(
      {
        repositories: [createEntry({ id: "repo-1", category: "repositories", name: "frontend" })],
        playbooks: [createEntry({ id: "playbook-1", category: "playbooks", name: "release" })],
      },
      ["run books"],
    );

    expect(groups.map((group) => group.id)).toEqual([
      "repositories",
      "docs",
      "config",
      "scripts",
      "playbooks",
      "run books",
    ]);
    expect(groups[4].label).toBe("Playbooks");
    expect(groups[5].isEmpty).toBe(true);
  });

  test("sorts entries by sort order and then name within a category", () => {
    const groups = buildWorkspaceCategoryGroups({
      repositories: [
        createEntry({ id: "repo-1", name: "zeta", sort_order: 2 }),
        createEntry({ id: "repo-2", name: "alpha", sort_order: 1 }),
        createEntry({ id: "repo-3", name: "beta", sort_order: 1 }),
      ],
    });

    expect(groups[0].entries.map((entry) => entry.name)).toEqual(["alpha", "beta", "zeta"]);
    expect(countWorkspaceEntries({ repositories: groups[0].entries })).toBe(3);
  });

  test("formats custom category labels into title case", () => {
    expect(formatWorkspaceCategoryLabel("run_books")).toBe("Run Books");
    expect(formatWorkspaceCategoryLabel("docs")).toBe("Docs");
  });
});
