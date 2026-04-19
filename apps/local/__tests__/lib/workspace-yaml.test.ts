/**
 * @jest-environment node
 */

import { deserializeWorkspace, serializeWorkspace } from "@/lib/workspace-yaml";
import type { WorkspaceEntry } from "@/lib/db";

function makeWorkspaceEntry(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    id: "entry-1",
    project_id: "proj-1",
    category: "repositories",
    name: "backend",
    path: "/Users/test/backend",
    purpose: "Backend API and services",
    sort_order: 0,
    created_at: "2026-04-19T00:00:00.000Z",
    updated_at: "2026-04-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("workspace-yaml", () => {
  describe("serializeWorkspace", () => {
    test("omits local paths from exported YAML", () => {
      const yaml = serializeWorkspace([
        makeWorkspaceEntry(),
        makeWorkspaceEntry({
          id: "entry-2",
          category: "docs",
          name: "specs",
          path: "/Users/test/specs",
          purpose: "Design specs",
        }),
      ]);

      expect(yaml).toContain("version: 1");
      expect(yaml).toContain("category: repositories");
      expect(yaml).toContain("name: backend");
      expect(yaml).not.toContain("/Users/test/backend");
      expect(yaml).not.toContain("path:");
    });

    test("preserves unknown categories with a stable fallback label", () => {
      const yaml = serializeWorkspace([
        makeWorkspaceEntry({
          category: "custom_tools",
          name: "ops-kit",
          purpose: null,
        }),
      ]);

      expect(yaml).toContain("id: custom_tools");
      expect(yaml).toContain("label: Custom Tools");
    });
  });

  describe("deserializeWorkspace", () => {
    test("deserializes valid YAML with unknown declared categories", () => {
      const yaml = `
version: 1
categories:
  - id: custom_tools
    label: Custom Tools
entries:
  - category: custom_tools
    name: ops-kit
    purpose: Shared scripts
`;

      expect(deserializeWorkspace(yaml)).toEqual({
        version: 1,
        categories: [{ id: "custom_tools", label: "Custom Tools" }],
        entries: [{ category: "custom_tools", name: "ops-kit", purpose: "Shared scripts" }],
      });
    });

    test("rejects unsupported versions", () => {
      expect(() => deserializeWorkspace("version: 2\ncategories: []\nentries: []\n")).toThrow(/version/i);
    });

    test("rejects duplicate category and name pairs", () => {
      const yaml = `
version: 1
categories:
  - id: repositories
    label: Repositories
entries:
  - category: repositories
    name: backend
    purpose: First
  - category: repositories
    name: backend
    purpose: Second
`;

      expect(() => deserializeWorkspace(yaml)).toThrow(/duplicate workspace entry/i);
    });

    test("rejects path values in imported entries", () => {
      const yaml = `
version: 1
categories:
  - id: repositories
    label: Repositories
entries:
  - category: repositories
    name: backend
    path: /tmp/backend
`;

      expect(() => deserializeWorkspace(yaml)).toThrow(/path/i);
    });

    test("rejects entries that reference undeclared categories", () => {
      const yaml = `
version: 1
categories:
  - id: docs
    label: Docs
entries:
  - category: repositories
    name: backend
`;

      expect(() => deserializeWorkspace(yaml)).toThrow(/unknown category/i);
    });
  });
});
