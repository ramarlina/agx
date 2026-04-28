/**
 * @jest-environment node
 */
import { scoreRepoMatch, suggestRepos } from "@/lib/repo-suggestions";

describe("scoreRepoMatch", () => {
  it("returns null when there are matching terms but no match anywhere", () => {
    expect(scoreRepoMatch("/Users/me/Code/random", "agx", "AGX Local")).toBeNull();
  });

  it("returns matchedOn=none when no terms supplied", () => {
    const result = scoreRepoMatch("/Users/me/foo", null, null);
    expect(result).toEqual({ matchedOn: "none", score: 0 });
  });

  it("scores exact basename match higher than substring", () => {
    const exact = scoreRepoMatch("/Users/me/Projects/agx", "agx", null);
    const substring = scoreRepoMatch("/Users/me/Projects/agx-cli", "agx", null);
    expect(exact).not.toBeNull();
    expect(substring).not.toBeNull();
    expect(exact!.score).toBeGreaterThan(substring!.score);
    expect(exact!.matchedOn).toBe("basename");
    expect(substring!.matchedOn).toBe("segment");
  });

  it("matches on a non-final path segment", () => {
    const result = scoreRepoMatch("/Users/me/agx-workspace/something", "agx", null);
    expect(result).not.toBeNull();
    expect(result!.matchedOn).toBe("segment");
  });

  it("is case-insensitive", () => {
    expect(scoreRepoMatch("/Users/me/AGX", "agx", null)?.matchedOn).toBe("basename");
    expect(scoreRepoMatch("/Users/me/MyProject", null, "myproject")?.matchedOn).toBe(
      "basename",
    );
  });

  it("matches on project name as well as slug", () => {
    expect(scoreRepoMatch("/x/cool-project", null, "cool-project")?.matchedOn).toBe(
      "basename",
    );
  });
});

describe("suggestRepos", () => {
  const paths = [
    "/Users/me/Projects/agx-cli",
    "/Users/me/Projects/agx",
    "/Users/me/agx-workspace/foo",
    "/Users/me/Projects/totally-unrelated",
    "/Users/me/Projects/AGX",
  ];

  it("filters out non-matching paths", () => {
    const out = suggestRepos(paths, { projectSlug: "agx" });
    expect(out.find((r) => r.path === "/Users/me/Projects/totally-unrelated")).toBeUndefined();
  });

  it("orders exact basename matches before substring ones", () => {
    const out = suggestRepos(paths, { projectSlug: "agx" });
    expect(out[0].matchedOn).toBe("basename");
    expect(out[0].path === "/Users/me/Projects/agx" || out[0].path === "/Users/me/Projects/AGX").toBe(true);
    // segment-level match (the ancestor segment "agx-workspace") should come last
    expect(out[out.length - 1].path).toBe("/Users/me/agx-workspace/foo");
  });

  it("breaks ties by shortest path", () => {
    const tied = [
      "/a/b/c/agx-cli",
      "/a/agx-cli",
    ];
    const out = suggestRepos(tied, { projectSlug: "agx" });
    expect(out[0].path).toBe("/a/agx-cli");
  });

  it("returns all repos up to limit when no terms supplied", () => {
    const out = suggestRepos(paths, { limit: 3 });
    expect(out).toHaveLength(3);
    expect(out.every((r) => r.matchedOn === "none")).toBe(true);
  });

  it("respects the limit", () => {
    const out = suggestRepos(paths, { projectSlug: "agx", limit: 2 });
    expect(out).toHaveLength(2);
  });

  it("includes basename and hasGit:true on each result", () => {
    const out = suggestRepos(["/a/b/agx"], { projectSlug: "agx" });
    expect(out[0].basename).toBe("agx");
    expect(out[0].hasGit).toBe(true);
  });
});
