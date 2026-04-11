import { serializeObjectiveFile } from "@/src/objectives/serializer";
import { parseObjectiveMarkdown } from "@/src/objectives/parser";
import type { ProjectObjective, ProjectObjectiveActivity, ProjectObjectiveActivityThreadMessage } from "@/lib/project-objectives";

function buildObjective(overrides: Partial<ProjectObjective> = {}): ProjectObjective {
  return {
    id: "objective_abc123",
    title: "Get 100 visitors daily",
    teamId: "team-growth",
    key: "get-100-visitors-daily",
    status: "on_track",
    progress: 0,
    cadence: "9 * * * *",
    condition: "",
    threadId: null,
    chatSessionVersion: 0,
    scheduledTaskIds: [],
    summary: "",
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-11T08:00:00.000Z",
    ...overrides,
  };
}

describe("objective serializer", () => {
  test("serializes an objective with notes and activities", () => {
    const objective = buildObjective({
      summary: "Focus on referral traffic first.",
      progress: 42,
      scheduledTaskIds: ["task_xyz"],
    });

    const activities: ProjectObjectiveActivity[] = [
      {
        id: "activity_1",
        objectiveId: "objective_abc123",
        sourceType: "note",
        sourceLabel: "Update",
        title: "Referral CTA refreshed",
        body: "Traffic quality is improving.",
        createdAt: "2026-04-09T13:00:00.000Z",
        updatedAt: "2026-04-09T13:00:00.000Z",
        relatedTaskId: null,
      },
    ];

    const threads: Record<string, ProjectObjectiveActivityThreadMessage[]> = {
      activity_1: [
        {
          id: "reply_1",
          activityId: "activity_1",
          author: "You",
          body: "Need owner follow-up",
          createdAt: "2026-04-09T13:30:00.000Z",
        },
      ],
    };

    const content = serializeObjectiveFile(objective, activities, threads);

    expect(content).toContain("---");
    expect(content).toContain("id: objective_abc123");
    expect(content).toContain("title: Get 100 visitors daily");
    expect(content).toContain("## Notes");
    expect(content).toContain("Focus on referral traffic first.");
    expect(content).toContain("## Activities");
    expect(content).toContain("### Referral CTA refreshed");
    expect(content).toContain("- **id:** activity_1");
    expect(content).toContain("#### Replies");
    expect(content).toContain("- **You** (2026-04-09T13:30:00.000Z): Need owner follow-up");
  });

  test("serializes a minimal objective without notes or activities", () => {
    const objective = buildObjective();
    const content = serializeObjectiveFile(objective, [], {});

    expect(content).toContain("---");
    expect(content).toContain("id: objective_abc123");
    expect(content).not.toContain("## Notes");
    expect(content).not.toContain("## Activities");
  });

  test("strips default/empty values from frontmatter", () => {
    const objective = buildObjective({
      condition: "",
      threadId: null,
      scheduledTaskIds: [],
      progress: 0,
      chatSessionVersion: 0,
    });

    const content = serializeObjectiveFile(objective, [], {});

    expect(content).not.toContain("condition:");
    expect(content).not.toContain("threadId:");
    expect(content).not.toContain("scheduledTaskIds:");
    expect(content).not.toContain("progress:");
    expect(content).not.toContain("chatSessionVersion:");
  });

  test("round-trips through parser", () => {
    const objective = buildObjective({
      summary: "Strategy notes here.",
      progress: 50,
      status: "at_risk",
      scheduledTaskIds: ["task_a", "task_b"],
      threadId: "thread-123",
      chatSessionVersion: 2,
    });

    const activities: ProjectObjectiveActivity[] = [
      {
        id: "activity_rt",
        objectiveId: "objective_abc123",
        sourceType: "note",
        sourceLabel: "Update",
        title: "Progress update",
        body: "Things are moving.",
        createdAt: "2026-04-09T14:00:00.000Z",
        updatedAt: "2026-04-09T14:00:00.000Z",
        relatedTaskId: null,
      },
    ];

    const content = serializeObjectiveFile(objective, activities, {});
    const parsed = parseObjectiveMarkdown(content);

    expect(parsed.objective.id).toBe(objective.id);
    expect(parsed.objective.title).toBe(objective.title);
    expect(parsed.objective.summary).toBe(objective.summary);
    expect(parsed.objective.status).toBe(objective.status);
    expect(parsed.objective.progress).toBe(objective.progress);
    expect(parsed.objective.scheduledTaskIds).toEqual(objective.scheduledTaskIds);
    expect(parsed.objective.threadId).toBe(objective.threadId);
    expect(parsed.activities).toHaveLength(1);
    expect(parsed.activities[0].id).toBe("activity_rt");
    expect(parsed.activities[0].title).toBe("Progress update");
  });
});
