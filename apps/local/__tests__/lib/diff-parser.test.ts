// apps/local/__tests__/lib/diff-parser.test.ts
/** @jest-environment node */
import { parseUnifiedDiff } from "@/lib/diff-parser";

describe("parseUnifiedDiff", () => {
  it("returns [] for null/empty patch", () => {
    expect(parseUnifiedDiff(null)).toEqual([]);
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("parses a single hunk with ctx/add/del lines and tracks line numbers", () => {
    const patch = [
      "@@ -1,3 +1,4 @@ imports",
      " import a from 'a';",
      "-import b from 'b';",
      "+import b from 'b2';",
      "+import c from 'c';",
      " import d from 'd';",
    ].join("\n");

    const hunks = parseUnifiedDiff(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].head).toBe("@@ -1,3 +1,4 @@ imports");
    expect(hunks[0].section).toBe("imports");
    expect(hunks[0].lines).toEqual([
      { o: 1, n: 1, k: "ctx", t: "import a from 'a';" },
      { o: 2, n: null, k: "del", t: "import b from 'b';" },
      { o: null, n: 2, k: "add", t: "import b from 'b2';" },
      { o: null, n: 3, k: "add", t: "import c from 'c';" },
      { o: 3, n: 4, k: "ctx", t: "import d from 'd';" },
    ]);
  });

  it("parses multiple hunks", () => {
    const patch = [
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "@@ -10,1 +11,1 @@ tail",
      "-x",
      "+y",
    ].join("\n");
    const hunks = parseUnifiedDiff(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[1].section).toBe("tail");
    expect(hunks[1].lines[0]).toEqual({ o: 10, n: null, k: "del", t: "x" });
    expect(hunks[1].lines[1]).toEqual({ o: null, n: 11, k: "add", t: "y" });
  });

  it("ignores '\\ No newline at end of file' markers", () => {
    const patch = [
      "@@ -1,1 +1,1 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
      "\\ No newline at end of file",
    ].join("\n");
    const hunks = parseUnifiedDiff(patch);
    expect(hunks[0].lines).toEqual([
      { o: 1, n: null, k: "del", t: "old" },
      { o: null, n: 1, k: "add", t: "new" },
    ]);
  });

  it("treats malformed input defensively (no hunk header => [])", () => {
    expect(parseUnifiedDiff("just some text\nno header")).toEqual([]);
  });
});
