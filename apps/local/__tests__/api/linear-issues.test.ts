/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockEnsureLinearIssueCache = jest.fn();
const mockListLinearIssueSummaries = jest.fn();
const mockGetLinearClient = jest.fn();

jest.mock("@/lib/linear-issues", () => ({
  ensureLinearIssueCache: (...args: unknown[]) => mockEnsureLinearIssueCache(...args),
  listLinearIssueSummaries: (...args: unknown[]) => mockListLinearIssueSummaries(...args),
}));

jest.mock("@/lib/linear-client", () => ({
  getLinearClient: () => mockGetLinearClient(),
}));

describe("/api/linear/issues", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLinearClient.mockReturnValue({ connected: true });
    mockEnsureLinearIssueCache.mockResolvedValue({
      issueCount: 1,
      complete: true,
      pulledAt: "2026-04-07T00:00:00.000Z",
    });
    mockListLinearIssueSummaries.mockResolvedValue({
      issues: [
        {
          id: "issue-1",
          identifier: "AGX-101",
          title: "Add copy link action",
          url: "https://linear.app/agx/issue/AGX-101/add-copy-link-action",
          status: "Todo",
          assignee: "Alex",
          updatedAt: "2026-04-07T00:00:00.000Z",
        },
      ],
      pageInfo: {
        hasNextPage: false,
        endCursor: null,
      },
      syncState: {
        lastPulledAt: "2026-04-07T00:00:00.000Z",
      },
    });
  });

  test("returns cached issue summaries with sync metadata", async () => {
    const { GET } = await import("@/app/api/linear/issues/route");
    const response = await GET(
      new NextRequest("http://localhost/api/linear/issues?projectSlug=agx&refresh=true")
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.issues).toEqual([
      {
        id: "issue-1",
        identifier: "AGX-101",
        title: "Add copy link action",
        url: "https://linear.app/agx/issue/AGX-101/add-copy-link-action",
        status: "Todo",
        assignee: "Alex",
        updatedAt: "2026-04-07T00:00:00.000Z",
      },
    ]);
    expect(data.refreshedAt).toBe("2026-04-07T00:00:00.000Z");
    expect(mockEnsureLinearIssueCache).toHaveBeenCalledWith({
      refresh: true,
      projectSlug: "agx",
    });
    expect(mockListLinearIssueSummaries).toHaveBeenCalledWith({
      statuses: [],
      search: undefined,
      assigneeIds: [],
      assignedToMe: false,
      teamId: undefined,
      cycleId: undefined,
      cursor: undefined,
      limit: 50,
    });
  });

  test("returns 401 when there is no cache and Linear is disconnected", async () => {
    mockEnsureLinearIssueCache.mockResolvedValue(null);
    mockListLinearIssueSummaries.mockResolvedValue({
      issues: [],
      pageInfo: {
        hasNextPage: false,
        endCursor: null,
      },
      syncState: {
        lastPulledAt: null,
      },
    });
    mockGetLinearClient.mockReturnValue(null);

    const { GET } = await import("@/app/api/linear/issues/route");
    const response = await GET(new NextRequest("http://localhost/api/linear/issues"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Not connected");
  });

  test("passes repeated assignee filters through to the cached issue query", async () => {
    const { GET } = await import("@/app/api/linear/issues/route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/linear/issues?status=Todo&status=In%20Progress&assigneeId=user-2&assigneeId=user-3&teamId=team-2"
      )
    );

    expect(response.status).toBe(200);
    expect(mockListLinearIssueSummaries).toHaveBeenCalledWith({
      statuses: ["Todo", "In Progress"],
      search: undefined,
      assigneeIds: ["user-2", "user-3"],
      assignedToMe: false,
      teamId: "team-2",
      cycleId: undefined,
      cursor: undefined,
      limit: 50,
    });
  });
});
