/**
 * @jest-environment node
 */
import { splitUnifiedDiffByFile } from "@/lib/gh-pr-cli";

describe("splitUnifiedDiffByFile", () => {
  test("returns empty map for empty input", () => {
    expect(splitUnifiedDiffByFile("").size).toBe(0);
  });

  test("splits a multi-file diff and strips git headers", () => {
    const diff = [
      "diff --git a/foo.ts b/foo.ts",
      "index abc..def 100644",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      " ctx",
      "diff --git a/bar.md b/bar.md",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/bar.md",
      "@@ -0,0 +1,1 @@",
      "+hello",
    ].join("\n");

    const map = splitUnifiedDiffByFile(diff);
    expect([...map.keys()]).toEqual(["foo.ts", "bar.md"]);
    expect(map.get("foo.ts")).toContain("@@ -1,2 +1,2 @@");
    expect(map.get("foo.ts")).toContain("+new");
    expect(map.get("foo.ts")).not.toContain("index abc");
    expect(map.get("bar.md")).toContain("+hello");
  });

  test("handles renames by using the new path", () => {
    const diff = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 100%",
      "rename from old.ts",
      "rename to new.ts",
      "@@ -1,1 +1,1 @@",
      "-x",
      "+y",
    ].join("\n");
    const map = splitUnifiedDiffByFile(diff);
    expect([...map.keys()]).toEqual(["new.ts"]);
    expect(map.get("new.ts")).toContain("+y");
  });
});
