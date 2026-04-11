import { buildSelectionHref, readUrlSelectionValue } from "@/hooks/useUrlSelection";

describe("useUrlSelection helpers", () => {
  test("reads trimmed selection values", () => {
    const searchParams = new URLSearchParams({ issue: "  issue-1  " });

    expect(readUrlSelectionValue(searchParams, "issue")).toBe("issue-1");
    expect(readUrlSelectionValue(searchParams, "run")).toBeNull();
  });

  test("clears run when the selected issue changes", () => {
    const href = buildSelectionHref(
      "/projects/agx/linear",
      new URLSearchParams("issue=issue-1&run=run-1"),
      { issue: "issue-2" },
    );

    expect(href).toBe("/projects/agx/linear?issue=issue-2");
  });

  test("preserves run when the selected issue is unchanged", () => {
    const href = buildSelectionHref(
      "/projects/agx/linear",
      new URLSearchParams("issue=issue-1&run=run-1"),
      { issue: "issue-1" },
    );

    expect(href).toBe("/projects/agx/linear?issue=issue-1&run=run-1");
  });

  test("clears run when the selected job changes", () => {
    const href = buildSelectionHref(
      "/projects/agx/automations",
      new URLSearchParams("job=job-1&run=run-1"),
      { job: "job-2" },
    );

    expect(href).toBe("/projects/agx/automations?job=job-2");
  });

  test("clears message when the open thread changes", () => {
    const href = buildSelectionHref(
      "/projects/agx/thread/thread-1",
      new URLSearchParams("open=root-1&message=msg-1"),
      { open: "root-2" },
    );

    expect(href).toBe("/projects/agx/thread/thread-1?open=root-2");
  });

  test("preserves an explicit message when changing the open thread", () => {
    const href = buildSelectionHref(
      "/projects/agx/thread/thread-1",
      new URLSearchParams("open=root-1&message=msg-1"),
      { open: "root-2", message: "msg-2" },
    );

    expect(href).toBe("/projects/agx/thread/thread-1?open=root-2&message=msg-2");
  });
});
