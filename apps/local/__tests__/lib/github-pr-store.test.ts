/** @jest-environment node */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-gh-pr-"));
  process.env.AGX_GITHUB_DIR = tmpDir;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.AGX_GITHUB_DIR;
});

import {
  upsertGithubPr,
  getGithubPr,
  listGithubPrs,
  deleteGithubPr,
  upsertPrLink,
  listPrLinksForPr,
  listPrLinksForTarget,
  deleteAutoPrLinks,
  upsertPrComments,
  listPrComments,
} from "@/lib/github-pr-store";
import type { GithubPr } from "@/lib/github-types";

const basePr: GithubPr = {
  id: "foo/bar#1",
  repoId: "foo/bar",
  number: 1,
  title: "Feat: do thing",
  body: "fixes AGX-42",
  state: "open",
  draft: false,
  authorLogin: "alice",
  headRef: "feat/agx-42",
  headSha: "deadbeef",
  baseRef: "main",
  url: "https://github.com/foo/bar/pull/1",
  ciStatus: "success",
  reviewDecision: "review_required",
  assignees: ["alice"],
  reviewers: [{ login: "bob", state: "pending" }],
  labels: ["feature"],
  createdAt: 1,
  updatedAt: 2,
  mergedAt: null,
  closedAt: null,
  lastSyncedAt: 3,
};

test("upsert + get round-trip preserves JSON fields", () => {
  upsertGithubPr(basePr);
  const got = getGithubPr("foo/bar#1");
  expect(got).toEqual(basePr);
});

test("list scopes by repo", () => {
  upsertGithubPr({ ...basePr, id: "foo/bar#2", number: 2, title: "Another" });
  upsertGithubPr({ ...basePr, id: "other/x#1", number: 1, repoId: "other/x" });
  const foo = listGithubPrs({ repoId: "foo/bar" });
  expect(foo.map((p) => p.id).sort()).toEqual(["foo/bar#1", "foo/bar#2"]);
});

test("pr_links upsert + list by pr", () => {
  upsertPrLink({ prId: "foo/bar#1", targetType: "agx_task", targetId: "AGX-42", linkSource: "body" });
  upsertPrLink({ prId: "foo/bar#1", targetType: "linear_issue", targetId: "LIN-7", linkSource: "manual" });
  const links = listPrLinksForPr("foo/bar#1");
  expect(links).toHaveLength(2);
});

test("pr_links list by target", () => {
  const links = listPrLinksForTarget("agx_task", "AGX-42");
  expect(links.map((l) => l.prId)).toEqual(["foo/bar#1"]);
});

test("deleteAutoPrLinks leaves manual links alone", () => {
  deleteAutoPrLinks("foo/bar#1");
  const links = listPrLinksForPr("foo/bar#1");
  expect(links).toHaveLength(1);
  expect(links[0].linkSource).toBe("manual");
});

test("comments upsert + list", () => {
  upsertPrComments([
    {
      id: "c1",
      prId: "foo/bar#1",
      kind: "issue_comment",
      authorLogin: "bob",
      body: "nit",
      path: null,
      line: null,
      createdAt: 10,
      updatedAt: 10,
    },
    {
      id: "c2",
      prId: "foo/bar#1",
      kind: "review_comment",
      authorLogin: "carol",
      body: "extract regex",
      path: "src/a.ts",
      line: 42,
      createdAt: 11,
      updatedAt: 11,
    },
  ]);
  const comments = listPrComments("foo/bar#1");
  expect(comments.map((c) => c.id)).toEqual(["c1", "c2"]);
  expect(comments[1].line).toBe(42);
});

test("deleteGithubPr cascades links and comments", () => {
  deleteGithubPr("foo/bar#1");
  expect(getGithubPr("foo/bar#1")).toBeNull();
  expect(listPrLinksForPr("foo/bar#1")).toHaveLength(0);
  expect(listPrComments("foo/bar#1")).toHaveLength(0);
});
