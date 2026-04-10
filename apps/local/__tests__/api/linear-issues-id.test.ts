/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetLinearClient = jest.fn();
const mockUpdateCachedLinearIssueStatus = jest.fn();

jest.mock("@/lib/linear-client", () => ({
  getLinearClient: () => mockGetLinearClient(),
}));

jest.mock("@/lib/linear-issue-store", () => ({
  updateCachedLinearIssueStatus: (...args: unknown[]) =>
    mockUpdateCachedLinearIssueStatus(...args),
}));

describe("/api/linear/issues/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("updates the issue status in Linear and mirrors it into the local cache", async () => {
    mockGetLinearClient.mockReturnValue({
      updateIssueStatus: jest.fn().mockResolvedValue({
        id: "issue-1",
        identifier: "AGX-101",
        title: "Add copy link action",
        url: "https://linear.app/agx/issue/AGX-101/add-copy-link-action",
        status: "In Progress",
        assignee: "Alex",
        updatedAt: "2026-04-09T00:00:00.000Z",
      }),
    });

    const { PATCH } = await import("@/app/api/linear/issues/[id]/route");
    const response = await PATCH(
      new NextRequest("http://localhost/api/linear/issues/issue-1", {
        method: "PATCH",
        body: JSON.stringify({ status: "In Progress" }),
      }),
      { params: Promise.resolve({ id: "issue-1" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.issue).toEqual(
      expect.objectContaining({
        id: "issue-1",
        status: "In Progress",
      })
    );
    expect(mockUpdateCachedLinearIssueStatus).toHaveBeenCalledWith({
      issueId: "issue-1",
      status: "In Progress",
      updatedAt: "2026-04-09T00:00:00.000Z",
    });
  });

  test("returns 401 when Linear is disconnected", async () => {
    mockGetLinearClient.mockReturnValue(null);

    const { PATCH } = await import("@/app/api/linear/issues/[id]/route");
    const response = await PATCH(
      new NextRequest("http://localhost/api/linear/issues/issue-1", {
        method: "PATCH",
        body: JSON.stringify({ status: "Done" }),
      }),
      { params: Promise.resolve({ id: "issue-1" }) }
    );

    expect(response.status).toBe(401);
  });
});
