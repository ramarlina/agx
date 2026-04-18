/** @jest-environment node */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-gh-sync-"));
  process.env.AGX_GITHUB_DIR = tmpDir;
  process.env.AGX_GITHUB_ENABLED = "1";
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.AGX_GITHUB_DIR;
  delete process.env.AGX_GITHUB_ENABLED;
});

import { upsertGithubRepo, listGithubRepos } from "@/lib/github-repo-store";
import { listGithubPrs, listPrLinksForPr } from "@/lib/github-pr-store";
import { syncRepo } from "@/lib/github-prs";
import type { GithubPr } from "@/lib/github-types";

const fakePr: GithubPr = {
  id: "foo/bar#7",
  repoId: "foo/bar",
  number: 7,
  title: "fix",
  body: "addresses AGX-42",
  state: "open",
  draft: false,
  authorLogin: "alice",
  headRef: "agx/AGX-42-fix",
  headSha: "sha",
  baseRef: "main",
  url: "https://example/pr/7",
  ciStatus: null,
  reviewDecision: null,
  assignees: [],
  reviewers: [],
  labels: [],
  createdAt: 10,
  updatedAt: 20,
  mergedAt: null,
  closedAt: null,
  lastSyncedAt: 30,
};

test("syncRepo upserts PRs and writes resolved link via first-hit resolver", async () => {
  upsertGithubRepo({
    owner: "foo",
    name: "bar",
    defaultBranch: "main",
    private: false,
  });
  const client = {
    listPullRequests: jest.fn().mockResolvedValue([fakePr]),
  };
  const resolver = jest.fn(async (id: string) =>
    id === "AGX-42"
      ? { targetType: "agx_task" as const, targetId: "AGX-42" }
      : null,
  );
  await syncRepo({
    repoId: "foo/bar",
    client: client as any,
    resolvers: [resolver],
  });
  const stored = listGithubPrs({ repoId: "foo/bar" });
  expect(stored).toHaveLength(1);
  const links = listPrLinksForPr("foo/bar#7");
  expect(links).toEqual([
    expect.objectContaining({
      targetType: "agx_task",
      targetId: "AGX-42",
      linkSource: "branch",
    }),
  ]);
  expect(
    listGithubRepos().find((r) => r.id === "foo/bar")?.lastSyncedAt,
  ).toBeGreaterThan(0);
});

test("syncRepo is no-op when feature flag disabled", async () => {
  process.env.AGX_GITHUB_ENABLED = "0";
  const client = { listPullRequests: jest.fn() };
  await syncRepo({
    repoId: "foo/bar",
    client: client as any,
    resolvers: [],
  });
  expect(client.listPullRequests).not.toHaveBeenCalled();
  process.env.AGX_GITHUB_ENABLED = "1";
});

test("syncRepo calls enrichPrStatus when available", async () => {
  const enriched: GithubPr = {
    ...fakePr,
    number: 8,
    id: "foo/bar#8",
    ciStatus: "success",
    reviewDecision: "approved",
  };
  const client = {
    listPullRequests: jest
      .fn()
      .mockResolvedValue([{ ...fakePr, number: 8, id: "foo/bar#8" }]),
    enrichPrStatus: jest.fn().mockResolvedValue(enriched),
  };
  await syncRepo({
    repoId: "foo/bar",
    client: client as any,
    resolvers: [],
  });
  expect(client.enrichPrStatus).toHaveBeenCalledTimes(1);
  const stored = listGithubPrs({ repoId: "foo/bar" }).find((p) => p.number === 8);
  expect(stored?.ciStatus).toBe("success");
  expect(stored?.reviewDecision).toBe("approved");
});

test("syncRepo re-resolves links when PR body changes", async () => {
  const client = {
    listPullRequests: jest.fn().mockResolvedValue([
      { ...fakePr, headRef: "feat/x", title: "retitled", body: "now LIN-9" },
    ]),
  };
  const resolver = jest.fn(async (id: string) =>
    id === "LIN-9"
      ? { targetType: "linear_issue" as const, targetId: "LIN-9" }
      : null,
  );
  await syncRepo({
    repoId: "foo/bar",
    client: client as any,
    resolvers: [resolver],
  });
  const links = listPrLinksForPr("foo/bar#7");
  expect(links).toHaveLength(1);
  expect(links[0]).toEqual(
    expect.objectContaining({
      targetType: "linear_issue",
      targetId: "LIN-9",
      linkSource: "body",
    }),
  );
});
