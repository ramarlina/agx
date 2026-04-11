import {
  LEGACY_PROJECT_GOALS_METADATA_KEY,
  PROJECT_OBJECTIVES_METADATA_KEY,
  addObjectiveActivity,
  appendObjectiveActivityThreadMessage,
  buildObjectiveTimelineActivities,
  createManualObjectiveActivity,
  createObjectiveActivityThreadMessage,
  createObjectiveManualTask,
  createProjectObjective,
  generateProjectObjectiveKey,
  readProjectObjectivesWorkspace,
  removeProjectObjective,
  upsertObjectiveManualTask,
  upsertProjectObjective,
  writeProjectObjectivesWorkspace,
} from "@/lib/project-objectives";

describe("project-objectives", () => {
  test("reads and writes a normalized objective workspace while preserving unrelated metadata", () => {
    const objective = createProjectObjective({
      id: "objective_growth",
      title: "Get 50 visitors daily",
      teamId: "team-growth",
      summary: "Focus on referral traffic first.",
      cadence: "Every weekday morning",
      condition: "traffic is below target",
      progress: 40,
      status: "at_risk",
      now: "2026-04-09T12:00:00.000Z",
    });
    let workspace = upsertProjectObjective(
      readProjectObjectivesWorkspace(undefined),
      objective
    );
    workspace = upsertObjectiveManualTask(
      workspace,
      objective.id,
      createObjectiveManualTask({
        id: "task-1",
        title: "Refresh referral CTA",
        notes: "Needs a clearer offer.",
        status: "in_progress",
        now: "2026-04-09T12:15:00.000Z",
      }),
      "2026-04-09T12:15:00.000Z"
    );

    const metadata = writeProjectObjectivesWorkspace({ owner: "marketing" }, workspace);
    const roundTrip = readProjectObjectivesWorkspace(metadata);

    expect(metadata.owner).toBe("marketing");
    expect(metadata[PROJECT_OBJECTIVES_METADATA_KEY]).toBeDefined();
    expect(roundTrip.objectives[0].title).toBe("Get 50 visitors daily");
    expect(roundTrip.objectives[0].manualTasks).toHaveLength(1);
    expect(roundTrip.objectives[0].cadence).toBe("Every weekday morning");
    expect(roundTrip.objectives[0].condition).toBe("traffic is below target");
    expect(roundTrip.objectives[0].teamId).toBe("team-growth");
    expect(roundTrip.objectives[0].key).toBe("get-50-visitors-daily");
    expect(roundTrip.objectives[0].scheduledTaskIds).toEqual([]);
  });

  test("migrates legacy goal metadata into the objective workspace", () => {
    const workspace = readProjectObjectivesWorkspace({
      [LEGACY_PROJECT_GOALS_METADATA_KEY]: {
        goals: [
          {
            id: "goal_launch",
            title: "Launch campaign",
            summary: "Keep content approvals moving.",
            target: "5k signups",
            progress: 62,
            status: "at_risk",
            createdAt: "2026-04-08T12:00:00.000Z",
            updatedAt: "2026-04-09T12:00:00.000Z",
          },
        ],
        manualActivities: [
          {
            id: "manual-1",
            goalId: "goal_launch",
            title: "Copy approval blocked",
            body: "Legal still needs one change.",
            createdAt: "2026-04-09T13:00:00.000Z",
            updatedAt: "2026-04-09T13:00:00.000Z",
          },
        ],
        activityThreads: {
          "manual-1": [
            {
              id: "message-1",
              author: "You",
              body: "Need owner follow-up",
              createdAt: "2026-04-09T13:30:00.000Z",
            },
          ],
        },
      },
    });

    expect(workspace.objectives).toHaveLength(1);
    expect(workspace.objectives[0].title).toBe("Launch campaign");
    expect(workspace.objectives[0].summary).toContain("Measure: 5k signups");
    expect(workspace.objectives[0].cadence).toBe("");
    expect(workspace.objectives[0].condition).toBe("");

    const timeline = buildObjectiveTimelineActivities({
      objective: workspace.objectives[0],
      workspace,
    });
    expect(timeline.map((entry) => entry.id)).toEqual(["manual-1"]);
    expect(timeline[0].threadCount).toBe(1);
  });

  test("builds a unified timeline from manual task and note activity", () => {
    const objective = createProjectObjective({
      id: "objective_growth",
      title: "Get 10 signups a day",
      teamId: "team-growth",
      now: "2026-04-09T12:00:00.000Z",
    });
    let workspace = upsertProjectObjective(
      readProjectObjectivesWorkspace(undefined),
      objective
    );
    workspace = addObjectiveActivity(
      workspace,
      createManualObjectiveActivity({
        id: "activity-note",
        objectiveId: objective.id,
        title: "Referral channel started moving",
        body: "Traffic quality is improving.",
        now: "2026-04-09T13:30:00.000Z",
      })
    );
    workspace = addObjectiveActivity(
      workspace,
      createManualObjectiveActivity({
        id: "activity-task",
        objectiveId: objective.id,
        title: "Refresh referral CTA",
        body: "Status changed to working.",
        sourceType: "manual_task",
        sourceLabel: "Manual task",
        relatedTaskId: "task-1",
        now: "2026-04-09T14:00:00.000Z",
      })
    );
    workspace = appendObjectiveActivityThreadMessage(
      workspace,
      createObjectiveActivityThreadMessage({
        activityId: "activity-task",
        body: "Need new copy options",
        now: "2026-04-09T14:15:00.000Z",
      })
    );

    const timeline = buildObjectiveTimelineActivities({ objective, workspace });

    expect(timeline.map((entry) => entry.id)).toEqual([
      "activity-task",
      "activity-note",
    ]);
    expect(timeline[0].threadCount).toBe(1);
    expect(timeline[0].sourceType).toBe("manual_task");
  });

  test("removes objective-owned tasks, activities, and threads when deleting an objective", () => {
    const objective = createProjectObjective({
      id: "objective_growth",
      title: "Get 10 signups a day",
      teamId: "team-growth",
      now: "2026-04-09T12:00:00.000Z",
    });
    let workspace = upsertProjectObjective(
      readProjectObjectivesWorkspace(undefined),
      objective
    );
    workspace = upsertObjectiveManualTask(
      workspace,
      objective.id,
      createObjectiveManualTask({
        id: "task-1",
        title: "Refresh CTA",
        now: "2026-04-09T12:05:00.000Z",
      }),
      "2026-04-09T12:05:00.000Z"
    );
    workspace = addObjectiveActivity(
      workspace,
      createManualObjectiveActivity({
        id: "activity-1",
        objectiveId: objective.id,
        title: "Refresh CTA",
        sourceType: "manual_task",
        sourceLabel: "Manual task",
        relatedTaskId: "task-1",
        now: "2026-04-09T12:10:00.000Z",
      })
    );
    workspace = appendObjectiveActivityThreadMessage(
      workspace,
      createObjectiveActivityThreadMessage({
        activityId: "activity-1",
        body: "Need one more review",
        now: "2026-04-09T12:15:00.000Z",
      })
    );

    const nextWorkspace = removeProjectObjective(workspace, objective.id);

    expect(nextWorkspace.objectives).toHaveLength(0);
    expect(nextWorkspace.activities).toHaveLength(0);
    expect(nextWorkspace.activityThreads["activity-1"]).toBeUndefined();
  });

  test("generates unique objective keys and normalizes legacy scheduled task ids", () => {
    const workspace = readProjectObjectivesWorkspace({
      [PROJECT_OBJECTIVES_METADATA_KEY]: {
        objectives: [
          {
            id: "objective-1",
            title: "Get 50 visitors daily",
            teamId: "team-growth",
            promptJobIds: ["job-a", "job-a", "", 12],
            createdAt: "2026-04-09T12:00:00.000Z",
            updatedAt: "2026-04-09T12:00:00.000Z",
          },
          {
            id: "objective-2",
            title: "Get 50 visitors daily",
            teamId: "team-product",
            createdAt: "2026-04-08T12:00:00.000Z",
            updatedAt: "2026-04-08T12:00:00.000Z",
          },
        ],
      },
    });

    expect(workspace.objectives.map((objective) => objective.key)).toEqual([
      "get-50-visitors-daily",
      "get-50-visitors-daily-2",
    ]);
    expect(workspace.objectives[0].scheduledTaskIds).toEqual(["job-a"]);
    expect(
      generateProjectObjectiveKey("Get 50 visitors daily", workspace.objectives)
    ).toBe("get-50-visitors-daily-3");
  });
});
