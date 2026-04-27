/**
 * @jest-environment node
 */
// apps/local/__tests__/api/github-pr-detail.test.ts
import type { GithubPr } from "@/lib/github-types";

jest.mock("@/lib/gh-pr-cli", () => ({
  fetchPrViaGh: jest.fn(),
}));

import { fetchPrViaGh } from "@/lib/gh-pr-cli";

const mockFetch = fetchPrViaGh as jest.MockedFunction<typeof fetchPrViaGh>;

const samplePr: GithubPr = {
  id: "foo/bar#7",
  repoId: "foo/bar",
  number: 7,
  title: "fix: race",
  body: "",
  state: "open",
  draft: false,
  authorLogin: "alice",
  headRef: "alice/fix",
  headSha: "deadbeef",
  baseRef: "main",
  url: "https://github.com/foo/bar/pull/7",
  ciStatus: "success",
  reviewDecision: "review_required",
  assignees: [],
  reviewers: [],
  labels: [],
  createdAt: 0,
  updatedAt: 0,
  mergedAt: null,
  closedAt: null,
  lastSyncedAt: 0,
};

describe("GET /api/github/prs/[id] (gh CLI)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  test("returns the gh-cli result on success", async () => {
    mockFetch.mockResolvedValue({ pr: samplePr, files: [], comments: [] });
    const { GET } = await import("@/app/api/github/prs/[id]/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/api/github/prs/foo%2Fbar%237");
    const res = await GET(req, { params: Promise.resolve({ id: "foo%2Fbar%237" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pr.id).toBe("foo/bar#7");
    expect(mockFetch).toHaveBeenCalledWith("foo/bar#7");
  });

  test("returns 404 when gh-cli resolves null", async () => {
    mockFetch.mockResolvedValue(null);
    const { GET } = await import("@/app/api/github/prs/[id]/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/api/github/prs/missing%2Frepo%231");
    const res = await GET(req, { params: Promise.resolve({ id: "missing%2Frepo%231" }) });
    expect(res.status).toBe(404);
  });

  test("returns 502 when gh-cli throws", async () => {
    mockFetch.mockRejectedValue(new Error("gh: command not found"));
    const { GET } = await import("@/app/api/github/prs/[id]/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/api/github/prs/foo%2Fbar%237");
    const res = await GET(req, { params: Promise.resolve({ id: "foo%2Fbar%237" }) });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/gh CLI failed/);
  });
});
