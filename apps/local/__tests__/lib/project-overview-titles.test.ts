import {
  deriveTitleFromText,
  resolveAutomationTitle,
  resolveThreadTitle,
} from "@/lib/project-overview-titles";

describe("project overview title helpers", () => {
  test("prefers task titles when the automation name is just a graph id", () => {
    expect(resolveAutomationTitle({
      automationName: "634a73de-401",
      graphId: "634a73de-401",
      taskTitle: "Daily performance check",
    })).toBe("Daily performance check");
  });

  test("derives a title from task content when no explicit task title exists", () => {
    expect(resolveAutomationTitle({
      graphId: "sched-bb878f",
      taskContent: "Review overnight regressions\nand prepare a summary",
    })).toBe("Review overnight regressions");
  });

  test("derives readable titles from message content", () => {
    expect(resolveThreadTitle({
      fallbackTitle: "Untitled thread",
      messages: [{
        id: "m1",
        role: "user",
        participantId: null,
        content: "Can you summarize the current release blockers for me?",
        timestamp: Date.now(),
      }],
    })).toBe("Can you summarize the current release blockers for me?");
  });

  test("strips agx markers when deriving text titles", () => {
    expect(deriveTitleFromText("[agx:spawn] Draft the launch checklist [reaction:done]")).toBe("Draft the launch checklist");
  });
});
