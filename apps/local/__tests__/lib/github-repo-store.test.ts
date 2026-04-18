/** @jest-environment node */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-gh-repo-"));
  process.env.AGX_GITHUB_DIR = tmpDir;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.AGX_GITHUB_DIR;
});

import {
  upsertGithubRepo,
  listGithubRepos,
  removeGithubRepo,
  markRepoSynced,
  markRepoAccessRevoked,
} from "@/lib/github-repo-store";

test("upsert and list", () => {
  upsertGithubRepo({ owner: "foo", name: "bar", defaultBranch: "main", private: true });
  upsertGithubRepo({ owner: "foo", name: "baz", defaultBranch: "main", private: false });
  const all = listGithubRepos();
  expect(all.map((r) => r.id).sort()).toEqual(["foo/bar", "foo/baz"]);
  expect(all.find((r) => r.id === "foo/bar")?.private).toBe(true);
});

test("upsert is idempotent and updates mutable fields", () => {
  upsertGithubRepo({ owner: "foo", name: "bar", defaultBranch: "develop", private: false });
  const rec = listGithubRepos().find((r) => r.id === "foo/bar");
  expect(rec?.defaultBranch).toBe("develop");
  expect(rec?.private).toBe(false);
});

test("markRepoSynced sets last_synced_at", () => {
  markRepoSynced("foo/bar", 1234567);
  const rec = listGithubRepos().find((r) => r.id === "foo/bar");
  expect(rec?.lastSyncedAt).toBe(1234567);
});

test("markRepoAccessRevoked flips flag", () => {
  markRepoAccessRevoked("foo/bar", true);
  expect(listGithubRepos().find((r) => r.id === "foo/bar")?.accessRevoked).toBe(true);
  markRepoAccessRevoked("foo/bar", false);
  expect(listGithubRepos().find((r) => r.id === "foo/bar")?.accessRevoked).toBe(false);
});

test("remove deletes the row", () => {
  removeGithubRepo("foo/bar");
  expect(listGithubRepos().map((r) => r.id)).toEqual(["foo/baz"]);
});
