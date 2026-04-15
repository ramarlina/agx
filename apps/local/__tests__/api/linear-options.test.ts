/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetLinearClient = jest.fn();
const mockUsers = jest.fn();
const mockTeams = jest.fn();
const mockCycles = jest.fn();
const mockEnsureLinearIssueCache = jest.fn();
const mockListCachedLinearIssueStatuses = jest.fn();

jest.mock("@/lib/linear-client", () => ({
  getLinearClient: (...args: unknown[]) => mockGetLinearClient(...args),
}));

jest.mock("@/lib/linear-issues", () => ({
  ensureLinearIssueCache: (...args: unknown[]) => mockEnsureLinearIssueCache(...args),
}));

jest.mock("@/lib/linear-issue-store", () => ({
  listCachedLinearIssueStatuses: (...args: unknown[]) => mockListCachedLinearIssueStatuses(...args),
}));

describe("/api/linear/options", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnsureLinearIssueCache.mockResolvedValue(null);
    mockListCachedLinearIssueStatuses.mockResolvedValue(["Backlog", "Todo"]);
    mockGetLinearClient.mockReturnValue({
      users: (...args: unknown[]) => mockUsers(...args),
      teams: (...args: unknown[]) => mockTeams(...args),
      cycles: (...args: unknown[]) => mockCycles(...args),
    });
  });

  test("returns filter options when all requests succeed", async () => {
    mockUsers.mockResolvedValue([{ id: "user-1", name: "Alex" }]);
    mockTeams.mockResolvedValue([{ id: "team-1", name: "Engineering" }]);
    mockCycles.mockResolvedValue([
      {
        id: "cycle-1",
        number: 42,
        name: "Sprint 42",
        startsAt: "2026-04-01T00:00:00.000Z",
        endsAt: "2026-04-14T00:00:00.000Z",
        teamId: "team-1",
        teamName: "Engineering",
      },
    ]);

    const { GET } = await import("@/app/api/linear/options/route");
    const response = await GET(
      new NextRequest("http://localhost/api/linear/options?projectId=proj-1&projectSlug=agx")
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockEnsureLinearIssueCache).toHaveBeenCalledWith({ projectId: "proj-1", projectSlug: "agx" });
    expect(data).toEqual({
      assignees: [{ id: "user-1", name: "Alex" }],
      statuses: ["Backlog", "Todo"],
      teams: [{ id: "team-1", name: "Engineering" }],
      cycles: [
        {
          id: "cycle-1",
          number: 42,
          name: "Sprint 42",
          startsAt: "2026-04-01T00:00:00.000Z",
          endsAt: "2026-04-14T00:00:00.000Z",
          teamId: "team-1",
          teamName: "Engineering",
        },
      ],
    });
  });

  test("still returns assignees and teams when cycles fail", async () => {
    mockUsers.mockResolvedValue([{ id: "user-1", name: "Alex" }]);
    mockTeams.mockResolvedValue([{ id: "team-1", name: "Engineering" }]);
    mockCycles.mockRejectedValue(new Error("cycle query failed"));

    const { GET } = await import("@/app/api/linear/options/route");
    const response = await GET(
      new NextRequest("http://localhost/api/linear/options?projectId=proj-1")
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      assignees: [{ id: "user-1", name: "Alex" }],
      statuses: ["Backlog", "Todo"],
      teams: [{ id: "team-1", name: "Engineering" }],
      cycles: [],
    });
  });
});
