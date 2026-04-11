import fs from "fs";
import path from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

import { ObjectiveRepository } from "@/src/objectives/repository";
import { serializeObjectiveFile } from "@/src/objectives/serializer";
import type { ProjectObjective, ProjectObjectiveActivity } from "@/lib/project-objectives";

function buildObjective(overrides: Partial<ProjectObjective> = {}): ProjectObjective {
  return {
    id: "objective_abc123",
    title: "Get 100 visitors daily",
    teamId: "team-growth",
    key: "get-100-visitors-daily",
    status: "on_track",
    progress: 0,
    cadence: "",
    condition: "",
    threadId: null,
    chatSessionVersion: 0,
    scheduledTaskIds: [],
    summary: "Focus on referral traffic.",
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-11T08:00:00.000Z",
    ...overrides,
  };
}

function buildActivity(overrides: Partial<ProjectObjectiveActivity> = {}): ProjectObjectiveActivity {
  return {
    id: "activity_1",
    objectiveId: "objective_abc123",
    sourceType: "note",
    sourceLabel: "Update",
    title: "Progress note",
    body: "Things are moving.",
    createdAt: "2026-04-09T13:00:00.000Z",
    updatedAt: "2026-04-09T13:00:00.000Z",
    relatedTaskId: null,
    ...overrides,
  };
}

describe("ObjectiveRepository", () => {
  let tmpDir: string;
  let repo: ObjectiveRepository;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "agx-objectives-test-"));
    repo = new ObjectiveRepository(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty workspace when directory does not exist", () => {
    const emptyRepo = new ObjectiveRepository(path.join(tmpDir, "nonexistent"));
    const workspace = emptyRepo.readWorkspace();

    expect(workspace.objectives).toHaveLength(0);
    expect(workspace.activities).toHaveLength(0);
    expect(workspace.activityThreads).toEqual({});
  });

  test("writes and reads back a workspace", () => {
    const objective = buildObjective();
    const activity = buildActivity();

    repo.writeWorkspace({
      objectives: [objective],
      activities: [activity],
      activityThreads: {},
    });

    const filePath = path.join(tmpDir, "get-100-visitors-daily.md");
    expect(fs.existsSync(filePath)).toBe(true);

    const workspace = repo.readWorkspace();
    expect(workspace.objectives).toHaveLength(1);
    expect(workspace.objectives[0].id).toBe("objective_abc123");
    expect(workspace.objectives[0].summary).toBe("Focus on referral traffic.");
    expect(workspace.activities).toHaveLength(1);
    expect(workspace.activities[0].id).toBe("activity_1");
  });

  test("cleans up stale files on write", () => {
    // Write initial
    repo.writeWorkspace({
      objectives: [buildObjective()],
      activities: [],
      activityThreads: {},
    });
    expect(fs.existsSync(path.join(tmpDir, "get-100-visitors-daily.md"))).toBe(true);

    // Write again without the objective
    repo.writeWorkspace({
      objectives: [],
      activities: [],
      activityThreads: {},
    });
    expect(fs.existsSync(path.join(tmpDir, "get-100-visitors-daily.md"))).toBe(false);
  });

  test("handles key renames by removing old file", () => {
    repo.writeWorkspace({
      objectives: [buildObjective()],
      activities: [],
      activityThreads: {},
    });
    expect(fs.existsSync(path.join(tmpDir, "get-100-visitors-daily.md"))).toBe(true);

    // Same objective ID, different key
    repo.writeWorkspace({
      objectives: [buildObjective({ key: "get-200-visitors-daily" })],
      activities: [],
      activityThreads: {},
    });
    expect(fs.existsSync(path.join(tmpDir, "get-100-visitors-daily.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "get-200-visitors-daily.md"))).toBe(true);
  });

  test("writes multiple objectives to separate files", () => {
    const obj1 = buildObjective({ id: "obj_1", key: "objective-one", title: "One" });
    const obj2 = buildObjective({ id: "obj_2", key: "objective-two", title: "Two" });

    repo.writeWorkspace({
      objectives: [obj1, obj2],
      activities: [],
      activityThreads: {},
    });

    expect(fs.existsSync(path.join(tmpDir, "objective-one.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "objective-two.md"))).toBe(true);

    const workspace = repo.readWorkspace();
    expect(workspace.objectives).toHaveLength(2);
  });

  test("hasFiles returns false for empty directory", () => {
    expect(repo.hasFiles()).toBe(false);
  });

  test("hasFiles returns true after writing", () => {
    repo.writeWorkspace({
      objectives: [buildObjective()],
      activities: [],
      activityThreads: {},
    });
    expect(repo.hasFiles()).toBe(true);
  });

  test("deleteObjective removes file", () => {
    repo.writeWorkspace({
      objectives: [buildObjective()],
      activities: [],
      activityThreads: {},
    });
    expect(repo.hasFiles()).toBe(true);

    const deleted = repo.deleteObjective("get-100-visitors-daily");
    expect(deleted).toBe(true);
    expect(repo.hasFiles()).toBe(false);
  });

  test("findObjectiveById scans all files", () => {
    const obj1 = buildObjective({ id: "obj_1", key: "first" });
    const obj2 = buildObjective({ id: "obj_2", key: "second" });

    repo.writeWorkspace({
      objectives: [obj1, obj2],
      activities: [],
      activityThreads: {},
    });

    const found = repo.findObjectiveById("obj_2");
    expect(found).not.toBeNull();
    expect(found!.key).toBe("second");

    const notFound = repo.findObjectiveById("obj_999");
    expect(notFound).toBeNull();
  });
});
