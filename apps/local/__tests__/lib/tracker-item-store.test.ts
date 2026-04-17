/**
 * @jest-environment node
 */

import fs from "fs";
import os from "os";
import path from "path";

function createTempTrackerDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agx-tracker-items-"));
}

describe("tracker-item-store", () => {
  let trackerDir = "";

  beforeEach(() => {
    jest.resetModules();
    trackerDir = createTempTrackerDir();
    process.env.AGX_TRACKER_DIR = trackerDir;
  });

  afterEach(() => {
    delete process.env.AGX_TRACKER_DIR;
    if (trackerDir) {
      fs.rmSync(trackerDir, { recursive: true, force: true });
    }
  });

  test("filters cached items by group ids using the shared cycle field", async () => {
    const { replaceCachedTrackerItems, listCachedTrackerItems } = await import(
      "@/lib/tracker/tracker-item-store"
    );

    await replaceCachedTrackerItems({
      trackerType: "linear",
      issues: [
        {
          id: "issue-1",
          trackerType: "linear",
          trackerId: "linear:team-1",
          identifier: "AGX-1",
          title: "First issue",
          status: "Todo",
          cycleId: "cycle-1",
          updatedAt: "2026-04-17T00:00:00.000Z",
        },
        {
          id: "issue-2",
          trackerType: "linear",
          trackerId: "linear:team-1",
          identifier: "AGX-2",
          title: "Second issue",
          status: "Todo",
          cycleId: "cycle-2",
          updatedAt: "2026-04-17T00:01:00.000Z",
        },
        {
          id: "issue-3",
          trackerType: "linear",
          trackerId: "linear:team-1",
          identifier: "AGX-3",
          title: "Backlog issue",
          status: "Todo",
          updatedAt: "2026-04-17T00:02:00.000Z",
        },
      ],
    });

    const filtered = await listCachedTrackerItems({
      trackerType: "linear",
      groupIds: ["cycle-2"],
    });

    expect(filtered.issues.map((issue) => issue.id)).toEqual(["issue-2"]);
  });

  test("accepts multiple group ids without breaking legacy cycleId filtering", async () => {
    const { replaceCachedTrackerItems, listCachedTrackerItems } = await import(
      "@/lib/tracker/tracker-item-store"
    );

    await replaceCachedTrackerItems({
      trackerType: "jira",
      issues: [
        {
          id: "issue-10",
          trackerType: "jira",
          trackerId: "jira:team-1",
          identifier: "JIRA-10",
          title: "Sprint A",
          status: "In Progress",
          cycleId: "sprint-a",
          updatedAt: "2026-04-17T00:00:00.000Z",
        },
        {
          id: "issue-11",
          trackerType: "jira",
          trackerId: "jira:team-1",
          identifier: "JIRA-11",
          title: "Sprint B",
          status: "In Progress",
          cycleId: "sprint-b",
          updatedAt: "2026-04-17T00:01:00.000Z",
        },
      ],
    });

    const byGroups = await listCachedTrackerItems({
      trackerType: "jira",
      groupIds: ["sprint-a", "sprint-b"],
    });
    const byCycleId = await listCachedTrackerItems({
      trackerType: "jira",
      cycleId: "sprint-a",
    });

    expect(byGroups.issues.map((issue) => issue.id)).toEqual(["issue-11", "issue-10"]);
    expect(byCycleId.issues.map((issue) => issue.id)).toEqual(["issue-10"]);
  });
});
