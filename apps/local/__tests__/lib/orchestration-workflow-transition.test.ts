/**
 * @jest-environment node
 */

const mockGetWorkflowNodeByName = jest.fn();

jest.mock("@/lib/db", () => ({
  getWorkflowNodeByName: (...args: unknown[]) => mockGetWorkflowNodeByName(...args),
  getWorkflowTransitionsFromNode: jest.fn(),
  getWorkflowNodes: jest.fn(),
}));

describe("resolveWorkflowTransition", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("keeps done stage terminal even when workflow has custom stages like intake", async () => {
    const { resolveWorkflowTransition } = await import("@/lib/orchestration/stage-machine");

    const result = await resolveWorkflowTransition({
      workflowId: "wf-1",
      currentNodeName: "done",
      decision: "done",
      retryCount: 2,
      maxRetries: 3,
    });

    expect(result.nextNodeName).toBe("done");
    expect(result.nextStatus).toBe("completed");
    expect(result.retryCount).toBe(0);
    expect(mockGetWorkflowNodeByName).not.toHaveBeenCalled();
  });
});
