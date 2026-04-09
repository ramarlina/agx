/**
 * @jest-environment node
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agx-vault-store-"));
}

function createMockSqliteDb(tables: Record<string, Array<Record<string, unknown>>>) {
  return {
    prepare(query: string) {
      const normalized = query.replace(/\s+/g, " ").trim();
      return {
        get: (...args: unknown[]) => {
          if (normalized.includes("FROM sqlite_master")) {
            const table = String(args[0] ?? "");
            return tables[table] ? { 1: 1 } : undefined;
          }
          throw new Error(`Unsupported get query: ${normalized}`);
        },
        all: () => {
          if (normalized.startsWith("SELECT * FROM ")) {
            const table = normalized.slice("SELECT * FROM ".length).trim();
            return tables[table] ?? [];
          }
          if (normalized.includes("FROM repo_knowledge")) {
            return tables.repo_knowledge ?? [];
          }
          if (normalized.includes("FROM knowledge_notes")) {
            return tables.knowledge_notes ?? [];
          }
          if (normalized.includes("FROM knowledge_entries")) {
            return tables.knowledge_entries ?? [];
          }
          if (normalized.includes("FROM agent_memory")) {
            return tables.agent_memory ?? [];
          }
          throw new Error(`Unsupported all query: ${normalized}`);
        },
      };
    },
  };
}

describe("VaultStore", () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test("creates project scaffolding and canonical project/repo notes", async () => {
    const rootDir = makeTempDir();

    try {
      const { VaultStore } = await import("@/lib/vault-store");
      const store = new VaultStore(rootDir);

      const project = store.createProject("user-1", {
        name: "AGX Cloud",
        description: "Knowledge migration",
        repos: [
          {
            name: "Frontend",
            path: "/tmp/frontend",
            notes: "Use the canonical repo note.",
          },
        ],
      });

      expect(project.slug).toBe("agx-cloud");
      expect(project.repos).toHaveLength(1);
      expect(store.listProjects("user-1")).toHaveLength(1);
      expect(store.getKnowledgeNote("repo", project.repos[0].id)?.content).toBe("Use the canonical repo note.");

      const updated = store.upsertKnowledgeNote({
        scope: "project",
        subjectId: project.id,
        content: "# Project context\n\nCanonical only.",
        changeSummary: "Manual edit",
        sourceType: "manual",
        sourceId: "test",
      });

      expect(updated.changed).toBe(true);
      expect(store.getKnowledgeNote("project", project.id)?.content).toContain("Canonical only.");
      expect(fs.existsSync(path.join(rootDir, ".agx", "registry.json"))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, project.slug, "Context", "Project.md"))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, project.slug, "Repos", "frontend", "Knowledge.md"))).toBe(true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("migrateFromLegacyDb prefers canonical knowledge_notes and preserves legacy artifacts", async () => {
    const rootDir = makeTempDir();
    const tables = {
      projects: [
        {
          id: "project-1",
          user_id: "user-1",
          name: "AGX Cloud",
          slug: "agx-cloud",
          description: "Legacy project",
          metadata: {},
          created_at: "2026-04-01T00:00:00.000Z",
          updated_at: "2026-04-02T00:00:00.000Z",
        },
      ],
      project_repos: [
        {
          id: "repo-1",
          project_id: "project-1",
          name: "Frontend",
          path: "/tmp/frontend",
          git_url: "https://example.com/frontend.git",
          notes: "Legacy repo notes",
          created_at: "2026-04-01T00:00:00.000Z",
          updated_at: "2026-04-02T00:00:00.000Z",
        },
      ],
      project_agents: [
        {
          project_id: "project-1",
          agent_id: "agent-1",
          routing_order: 0,
          created_at: "2026-04-01T00:00:00.000Z",
        },
      ],
      project_skills: [
        {
          id: "skill-1",
          project_id: "project-1",
          file: "/tmp/skill.md",
          condition: "When editing prompts",
          created_at: "2026-04-01T00:00:00.000Z",
        },
      ],
      project_variables: [
        {
          project_id: "project-1",
          key: "DEPLOY_ENV",
          value: "staging",
        },
      ],
      project_threads: [
        {
          project_id: "project-1",
          thread_id: "thread-1",
          created_at: "2026-04-01T00:00:00.000Z",
        },
      ],
      project_memory: [
        {
          id: "memory-1",
          project_id: "project-1",
          content: "Legacy synthesized project memory",
          source: "legacy",
          producer: "system",
          created_at: "2026-04-01T00:00:00.000Z",
        },
      ],
      repo_knowledge: [
        {
          id: "repo-knowledge-1",
          repo_id: "repo-1",
          content: "Legacy repo knowledge row",
          producer: "system",
          created_at: "2026-04-01T00:00:00.000Z",
        },
      ],
      knowledge_notes: [
        {
          id: "project-note-1",
          scope: "project",
          subject_id: "project-1",
          content: "# Canonical project note\n\nFrom knowledge_notes.",
          change_summary: "Imported project note",
          source_type: "manual",
          source_id: "legacy",
          metadata: JSON.stringify({ imported: true }),
          version: 3,
          created_at: "2026-04-01T00:00:00.000Z",
          updated_at: "2026-04-03T00:00:00.000Z",
        },
        {
          id: "repo-note-1",
          scope: "repo",
          subject_id: "repo-1",
          content: "# Canonical repo note\n\nFrom knowledge_notes.",
          change_summary: "Imported repo note",
          source_type: "manual",
          source_id: "legacy",
          metadata: JSON.stringify({ imported: true }),
          version: 2,
          created_at: "2026-04-01T00:00:00.000Z",
          updated_at: "2026-04-03T00:00:00.000Z",
        },
      ],
      knowledge_entries: [
        {
          id: "entry-1",
          scope: "project",
          subject_id: "project-1",
          source_type: "manual",
          source_id: "legacy",
          kind: "decision",
          title: "Prefer vault",
          body: "Files are the durable source of truth.",
          confidence: 0.9,
          durability: 0.8,
          tags: JSON.stringify(["migration"]),
          evidence: JSON.stringify([{ note: "Imported evidence" }]),
          metadata: JSON.stringify({ source: "legacy" }),
          content_hash: "legacy-hash",
          created_at: "2026-04-01T00:00:00.000Z",
          updated_at: "2026-04-03T00:00:00.000Z",
        },
      ],
      learnings: [
        {
          id: "learning-1",
          scope: "global",
          scope_id: null,
          user_id: "user-1",
          content: "Prefer the vault over the database.",
          created_at: "2026-04-01T00:00:00.000Z",
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Planner",
          description: "Portable agent context",
          created_at: "2026-04-01T00:00:00.000Z",
          updated_at: "2026-04-02T00:00:00.000Z",
        },
      ],
      agent_memory: [
        {
          id: "agent-memory-1",
          agent_id: "agent-1",
          content: "Legacy agent memory",
          created_at: "2026-04-01T00:00:00.000Z",
        },
      ],
    };

    try {
      jest.doMock("@/lib/sqlite-query-adapter", () => ({
        getSQLiteDb: () => createMockSqliteDb(tables),
      }));

      const { VaultStore } = await import("@/lib/vault-store");
      const store = new VaultStore(rootDir);
      const result = store.migrateFromLegacyDb();

      expect(result).toMatchObject({
        projects: 1,
        repos: 1,
        agents: 1,
      });
      expect(store.getKnowledgeNote("project", "project-1")?.content).toContain("From knowledge_notes.");
      expect(store.getKnowledgeNote("project", "project-1")?.content).not.toContain("Legacy synthesized project memory");
      expect(store.getKnowledgeNote("repo", "repo-1")?.content).toContain("From knowledge_notes.");
      expect(store.getLearnings("global")[0]?.content).toContain("Prefer the vault over the database.");
      expect(
        fs.existsSync(
          path.join(rootDir, "agx-cloud", "_generated", "imported", "project-memory", "memory-1.md")
        )
      ).toBe(true);
      expect(
        store.listKnowledgeEntries({ scope: "project", subjectId: "project-1" }).map((entry) => entry.title)
      ).toContain("Prefer vault");
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
