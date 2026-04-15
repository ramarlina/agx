/**
 * @jest-environment node
 */
describe("linear-recap/runner", () => {
  test("enqueue dedupes concurrent calls for the same issue", async () => {
    const { createRunner } = await import("@/src/linear-recap/runner");

    let resolveFirst!: () => void;
    const firstRun = new Promise<void>((r) => (resolveFirst = r));
    let invocations = 0;
    const generate = jest.fn(async (_issueId: string) => {
      invocations++;
      await firstRun;
    });

    const runner = createRunner({ generate });
    const a = runner.enqueue("issue-1");
    const b = runner.enqueue("issue-1");
    expect(a.status).toBe("queued");
    expect(b.status).toBe("queued");
    expect(runner.get("issue-1")?.status).toMatch(/queued|running/);

    resolveFirst();
    await new Promise((r) => setTimeout(r, 20));
    expect(invocations).toBe(1);
    expect(runner.get("issue-1")).toBeNull();
  });

  test("enqueue after previous completion triggers a new run", async () => {
    const { createRunner } = await import("@/src/linear-recap/runner");
    let invocations = 0;
    const generate = jest.fn(async () => {
      invocations++;
    });
    const runner = createRunner({ generate });

    runner.enqueue("issue-2");
    await new Promise((r) => setTimeout(r, 10));
    runner.enqueue("issue-2");
    await new Promise((r) => setTimeout(r, 10));
    expect(invocations).toBe(2);
  });

  test("failures are recorded briefly then cleared", async () => {
    jest.useFakeTimers();
    const { createRunner } = await import("@/src/linear-recap/runner");
    const err = new Error("boom");
    const generate = jest.fn(async () => {
      throw err;
    });
    const runner = createRunner({ generate, failureHoldMs: 60_000 });

    runner.enqueue("issue-3");
    await Promise.resolve();
    await Promise.resolve();

    const state = runner.get("issue-3");
    expect(state?.status).toBe("failed");
    expect(state?.error).toBe("boom");

    jest.advanceTimersByTime(60_001);
    expect(runner.get("issue-3")).toBeNull();
    jest.useRealTimers();
  });
});
