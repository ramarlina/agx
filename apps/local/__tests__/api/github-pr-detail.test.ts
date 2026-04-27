/**
 * @jest-environment node
 */
// apps/local/__tests__/api/github-pr-detail.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-gh-pr-detail-"));
  process.env.AGX_GITHUB_DIR = tmpDir;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.AGX_GITHUB_DIR;
});

import { upsertGithubPr, upsertPrComments } from "@/lib/github-pr-store";
import { upsertPrFiles } from "@/lib/github-pr-files-store";
import type { GithubPr, GithubPrComment, GithubPrFile } from "@/lib/github-types";

const pr: GithubPr = {
  id: "foo/bar#7",
  repoId: "foo/bar",
  number: 7,
  title: "fix: race",
  body: "closes AGX-1",
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
  createdAt: 1,
  updatedAt: 2,
  mergedAt: null,
  closedAt: null,
  lastSyncedAt: 3,
};

const file: GithubPrFile = {
  prId: "foo/bar#7",
  path: "a.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  changes: 2,
  patch: "@@ -1,1 +1,1 @@\n-old\n+new",
  lastSyncedAt: 3,
};

const comment: GithubPrComment = {
  id: "c1",
  prId: "foo/bar#7",
  kind: "review_comment",
  authorLogin: "bob",
  body: "nit",
  path: "a.ts",
  line: 1,
  createdAt: 1,
  updatedAt: 1,
};

describe("GET /api/github/prs/[id]", () => {
  beforeAll(() => {
    upsertGithubPr(pr);
    upsertPrFiles([file]);
    upsertPrComments([comment]);
  });

  it("returns pr + files + comments for a known id", async () => {
    const { GET } = await import("@/app/api/github/prs/[id]/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://x/api/github/prs/foo%2Fbar%237");
    const res = await GET(req, { params: Promise.resolve({ id: "foo%2Fbar%237" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pr.id).toBe("foo/bar#7");
    expect(body.files).toHaveLength(1);
    expect(body.files[0].path).toBe("a.ts");
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].body).toBe("nit");
  });

  it("returns 404 for an unknown id", async () => {
    const { GET } = await import("@/app/api/github/prs/[id]/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://x/api/github/prs/missing");
    const res = await GET(req, { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });
});
