import { isIntervalScheduleOverdue, isScheduledRunOverdue } from "@/src/scheduling/status";

describe("schedule overdue helpers", () => {
  const now = Date.UTC(2026, 3, 19, 15, 30, 0);

  describe("isScheduledRunOverdue", () => {
    it("keeps a manual catch-up run healthy when the next scheduled slot is still ahead", () => {
      expect(
        isScheduledRunOverdue({
          state: "active",
          nextScheduledAt: Date.UTC(2026, 3, 19, 23, 30, 0),
          lastCompletedAt: Date.UTC(2026, 3, 19, 15, 25, 0),
          now,
        }),
      ).toBe(false);
    });

    it("marks a truly missed scheduled slot as overdue", () => {
      expect(
        isScheduledRunOverdue({
          state: "active",
          nextScheduledAt: Date.UTC(2026, 3, 19, 15, 0, 0),
          lastCompletedAt: Date.UTC(2026, 3, 19, 14, 0, 0),
          now,
        }),
      ).toBe(true);
    });

    it("clears overdue once the missed slot has been satisfied", () => {
      expect(
        isScheduledRunOverdue({
          state: "active",
          nextScheduledAt: Date.UTC(2026, 3, 19, 15, 0, 0),
          lastCompletedAt: Date.UTC(2026, 3, 19, 15, 10, 0),
          now,
        }),
      ).toBe(false);
    });

    it("suppresses overdue while execution is in progress", () => {
      expect(
        isScheduledRunOverdue({
          state: "active",
          nextScheduledAt: Date.UTC(2026, 3, 19, 15, 0, 0),
          lastCompletedAt: Date.UTC(2026, 3, 19, 14, 0, 0),
          inProgress: true,
          now,
        }),
      ).toBe(false);
    });
  });

  describe("isIntervalScheduleOverdue", () => {
    it("marks interval schedules overdue when the next tick should already have happened", () => {
      expect(
        isIntervalScheduleOverdue({
          state: "active",
          lastCompletedAt: Date.UTC(2026, 3, 19, 15, 0, 0),
          intervalMs: 15 * 60_000,
          now,
        }),
      ).toBe(true);
    });
  });
});
