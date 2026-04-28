/**
 * @jest-environment node
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-project-sync-"));
  return path.join(dir, "agx-board.db");
}

async function loadProjectsModule(dbPath: string) {
  jest.resetModules();
  process.env.SQLITE_DB_PATH = dbPath;
  process.env.AGX_DATA_DIR = path.dirname(dbPath);
  return import("@/lib/db/projects");
}

describe("project repo workspace sync", () => {
  const dbPaths: string[] = [];

  afterEach(() => {
    delete process.env.SQLITE_DB_PATH;
    delete process.env.AGX_DATA_DIR;
    jest.resetModules();
  });

  afterAll(() => {
    for (const dbPath of dbPaths) {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });

  test("creates a repositories workspace entry for a project repo", async () => {
    const dbPath = makeTempDbPath();
    dbPaths.push(dbPath);
    const { createProject, getProjectWorkspace } = await loadProjectsModule(dbPath);

    const project = await createProject("user-1", {
      name: "Founder Sprint",
      repos: [{ name: "agx-cloud", path: "/Users/mendrika/Projects/Agents/agx-cloud" }],
    });

    const workspace = await getProjectWorkspace(project.id);
    expect(workspace.repositories).toEqual([
      expect.objectContaining({
        category: "repositories",
        name: "agx-cloud",
        path: "/Users/mendrika/Projects/Agents/agx-cloud",
      }),
    ]);
  });

  test("keeps the workspace map aligned when project repos are edited", async () => {
    const dbPath = makeTempDbPath();
    dbPaths.push(dbPath);
    const { createProject, getProjectWorkspace, updateProject } = await loadProjectsModule(dbPath);

    const project = await createProject("user-1", {
      name: "Repo Edit",
      repos: [{ name: "old-name", path: "/tmp/old" }],
    });

    await updateProject(project.id, "user-1", {
      repos: [{ id: project.repos[0].id, name: "new-name", path: "/tmp/new" }],
    });

    const workspace = await getProjectWorkspace(project.id);
    expect(workspace.repositories).toHaveLength(1);
    expect(workspace.repositories[0]).toEqual(
      expect.objectContaining({
        name: "new-name",
        path: "/tmp/new",
      })
    );
  });

  test("preserves unrelated manual workspace entries", async () => {
    const dbPath = makeTempDbPath();
    dbPaths.push(dbPath);
    const {
      createProject,
      createWorkspaceEntry,
      getProjectWorkspace,
      updateProject,
    } = await loadProjectsModule(dbPath);

    const project = await createProject("user-1", {
      name: "Manual Entry",
      repos: [{ name: "app", path: "/tmp/app" }],
    });
    await createWorkspaceEntry(project.id, {
      category: "repositories",
      name: "docs",
      path: "/tmp/docs",
      purpose: "Manual docs map",
    });

    await updateProject(project.id, "user-1", {
      repos: [{ id: project.repos[0].id, name: "app", path: "/tmp/app-renamed" }],
    });

    const workspace = await getProjectWorkspace(project.id);
    expect(workspace.repositories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "app", path: "/tmp/app-renamed" }),
        expect.objectContaining({ name: "docs", path: "/tmp/docs", purpose: "Manual docs map" }),
      ])
    );
    expect(workspace.repositories).toHaveLength(2);
  });

  test("uses the repository name as the workspace map identity on collisions", async () => {
    const dbPath = makeTempDbPath();
    dbPaths.push(dbPath);
    const {
      createProject,
      createWorkspaceEntry,
      getProjectWorkspace,
      updateProject,
    } = await loadProjectsModule(dbPath);

    const project = await createProject("user-1", {
      name: "Name Collision",
    });
    await createWorkspaceEntry(project.id, {
      category: "repositories",
      name: "app",
      path: "/tmp/manual-app",
      purpose: "Manual notes",
    });

    await updateProject(project.id, "user-1", {
      repos: [{ name: "app", path: "/tmp/project-repo-app" }],
    });

    const workspace = await getProjectWorkspace(project.id);
    expect(workspace.repositories).toEqual([
      expect.objectContaining({
        name: "app",
        path: "/tmp/project-repo-app",
        purpose: "Manual notes",
      }),
    ]);
  });

  test("does not delete workspace entries when project repos are removed", async () => {
    const dbPath = makeTempDbPath();
    dbPaths.push(dbPath);
    const { createProject, getProjectWorkspace, updateProject } = await loadProjectsModule(dbPath);

    const project = await createProject("user-1", {
      name: "Repo Removal",
      repos: [{ name: "app", path: "/tmp/app" }],
    });

    await updateProject(project.id, "user-1", {
      repos: [],
    });

    const workspace = await getProjectWorkspace(project.id);
    expect(workspace.repositories).toEqual([
      expect.objectContaining({
        name: "app",
        path: "/tmp/app",
      }),
    ]);
  });

  test("updates generated workspace purpose when repo notes change", async () => {
    const dbPath = makeTempDbPath();
    dbPaths.push(dbPath);
    const { createProject, getProjectWorkspace, updateProject } = await loadProjectsModule(dbPath);

    const project = await createProject("user-1", {
      name: "Repo Notes",
      repos: [{ name: "app", path: "/tmp/app", notes: "Original purpose" }],
    });

    await updateProject(project.id, "user-1", {
      repos: [{ id: project.repos[0].id, name: "app", path: "/tmp/app", notes: "Updated purpose" }],
    });

    const workspace = await getProjectWorkspace(project.id);
    expect(workspace.repositories).toEqual([
      expect.objectContaining({
        name: "app",
        path: "/tmp/app",
        purpose: "Updated purpose",
      }),
    ]);
  });

  test("keeps workspace entries aligned when repo names are swapped", async () => {
    const dbPath = makeTempDbPath();
    dbPaths.push(dbPath);
    const { createProject, getProjectWorkspace, updateProject } = await loadProjectsModule(dbPath);

    const project = await createProject("user-1", {
      name: "Repo Swap",
      repos: [
        { name: "api", path: "/tmp/api" },
        { name: "web", path: "/tmp/web" },
      ],
    });

    await updateProject(project.id, "user-1", {
      repos: [
        { id: project.repos[0].id, name: "web", path: "/tmp/api" },
        { id: project.repos[1].id, name: "api", path: "/tmp/web" },
      ],
    });

    const workspace = await getProjectWorkspace(project.id);
    expect(workspace.repositories).toEqual([
      expect.objectContaining({ name: "web", path: "/tmp/api" }),
      expect.objectContaining({ name: "api", path: "/tmp/web" }),
    ]);
  });
});
