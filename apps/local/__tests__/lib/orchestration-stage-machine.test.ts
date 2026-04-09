/**
 * @jest-environment node
 */

import { getNextStage, resolveStageTransition } from "@/lib/orchestration/stage-machine";

describe("orchestration stage machine", () => {
  test("advances standard task stages", () => {
    expect(getNextStage("INTAKE", "task")).toBe("PROGRESS");
    expect(getNextStage("PROGRESS", "task")).toBe("DONE");
    expect(getNextStage("DONE", "task")).toBeNull();
  });

  test("uses spike fast path", () => {
    expect(getNextStage("INTAKE", "spike")).toBe("PROGRESS");
    expect(getNextStage("PROGRESS", "spike")).toBe("DONE");
  });

  test("PROGRESS always retries with reset count (infinite retry semantics)", () => {
    const retry = resolveStageTransition({
      currentStage: "PROGRESS",
      decision: "failed",
      ticketType: "task",
      retryCount: 1,
      maxRetries: 3,
    });

    expect(retry.nextStage).toBe("PROGRESS");
    expect(retry.nextStatus).toBe("queued");
    expect(retry.retryCount).toBe(0);
  });

  test("retries non-PROGRESS stage before failing task", () => {
    const retry = resolveStageTransition({
      currentStage: "INTAKE",
      decision: "failed",
      ticketType: "task",
      retryCount: 1,
      maxRetries: 3,
    });

    expect(retry.nextStage).toBe("INTAKE");
    expect(retry.nextStatus).toBe("queued");
    expect(retry.retryCount).toBe(2);

    const exhausted = resolveStageTransition({
      currentStage: "INTAKE",
      decision: "failed",
      ticketType: "task",
      retryCount: 3,
      maxRetries: 3,
    });

    expect(exhausted.nextStatus).toBe("failed");
  });
});
