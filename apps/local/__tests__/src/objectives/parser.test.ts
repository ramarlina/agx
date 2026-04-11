import { parseObjectiveMarkdown, parseObjectiveBody } from "@/src/objectives/parser";

describe("objective parser", () => {
  test("parses a complete objective file with notes, activities, and replies", () => {
    const markdown = `---
id: objective_abc123
title: Get 100 visitors daily
teamId: team-growth
key: get-100-visitors-daily
status: on_track
progress: 42
cadence: "9 * * * *"
condition: traffic is below target
threadId: "objective-chat:objective_abc123"
chatSessionVersion: 2
scheduledTaskIds:
  - task_xyz
createdAt: 2026-04-10T10:00:00.000Z
updatedAt: 2026-04-11T08:00:00.000Z
---

## Notes

Focus on referral traffic first.

## Activities

### Referral CTA refreshed
- **id:** activity_referral_update
- **source:** Update
- **created:** 2026-04-09T13:00:00.000Z
- **body:** Traffic quality is improving.

#### Replies
- **You** (2026-04-09T13:30:00.000Z): Need owner follow-up
- **Jane** (2026-04-09T14:00:00.000Z): I will handle it

### Baseline check
- **id:** activity_baseline
- **source:** Update
- **created:** 2026-04-09T12:00:00.000Z
- **body:** Current baseline is 5 visitors per day.
`;

    const result = parseObjectiveMarkdown(markdown);

    expect(result.objective.id).toBe("objective_abc123");
    expect(result.objective.title).toBe("Get 100 visitors daily");
    expect(result.objective.teamId).toBe("team-growth");
    expect(result.objective.key).toBe("get-100-visitors-daily");
    expect(result.objective.status).toBe("on_track");
    expect(result.objective.progress).toBe(42);
    expect(result.objective.cadence).toBe("9 * * * *");
    expect(result.objective.condition).toBe("traffic is below target");
    expect(result.objective.threadId).toBe("objective-chat:objective_abc123");
    expect(result.objective.chatSessionVersion).toBe(2);
    expect(result.objective.scheduledTaskIds).toEqual(["task_xyz"]);
    expect(result.objective.summary).toBe("Focus on referral traffic first.");

    expect(result.activities).toHaveLength(2);
    expect(result.activities[0].id).toBe("activity_referral_update");
    expect(result.activities[0].title).toBe("Referral CTA refreshed");
    expect(result.activities[0].sourceLabel).toBe("Update");
    expect(result.activities[0].body).toBe("Traffic quality is improving.");
    expect(result.activities[0].objectiveId).toBe("objective_abc123");

    expect(result.activities[1].id).toBe("activity_baseline");
    expect(result.activities[1].title).toBe("Baseline check");

    const replies = result.activityThreads["activity_referral_update"];
    expect(replies).toHaveLength(2);
    expect(replies[0].author).toBe("You");
    expect(replies[0].body).toBe("Need owner follow-up");
    expect(replies[1].author).toBe("Jane");
  });

  test("parses a minimal objective file with no body", () => {
    const markdown = `---
id: objective_minimal
title: Ship v3
teamId: team-eng
key: ship-v3
status: on_track
createdAt: 2026-04-10T10:00:00.000Z
updatedAt: 2026-04-10T10:00:00.000Z
---
`;

    const result = parseObjectiveMarkdown(markdown);

    expect(result.objective.id).toBe("objective_minimal");
    expect(result.objective.title).toBe("Ship v3");
    expect(result.objective.summary).toBe("");
    expect(result.activities).toHaveLength(0);
    expect(result.activityThreads).toEqual({});
  });

  test("throws on missing frontmatter", () => {
    expect(() => parseObjectiveMarkdown("just some text")).toThrow(
      "Objective file is missing YAML frontmatter",
    );
  });

  test("parses body with notes only (no activities)", () => {
    const body = "## Notes\n\nThis is the strategy.";
    const { summary, activities } = parseObjectiveBody(body, "obj_1");

    expect(summary).toBe("This is the strategy.");
    expect(activities).toHaveLength(0);
  });

  test("parses plain text body as summary", () => {
    const body = "Just a plain text summary without headings.";
    const { summary } = parseObjectiveBody(body, "obj_1");

    expect(summary).toBe("Just a plain text summary without headings.");
  });
});
