/**
 * @jest-environment node
 */
jest.mock("node:child_process", () => ({
  execFile: jest.fn(),
}));

import { execFile } from "node:child_process";

type ExecFileCb = (
  err: Error | null,
  out: { stdout: string; stderr: string },
) => void;

const mockedExecFile = execFile as unknown as jest.Mock;

interface Canned {
  match: (args: string[]) => boolean;
  stdout: string;
}

function installRouter(canned: Canned[]) {
  mockedExecFile.mockImplementation(
    (
      _cmd: string,
      args: string[],
      _opts: unknown,
      cb: ExecFileCb,
    ) => {
      // promisify(execFile) calls with (cmd, args, opts, cb)
      const hit = canned.find((c) => c.match(args));
      if (!hit) {
        cb(new Error(`no canned match for: ${args.join(" ")}`), {
          stdout: "",
          stderr: "",
        });
        return;
      }
      cb(null, { stdout: hit.stdout, stderr: "" });
    },
  );
}

describe("git-diff-cli", () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
  });

  test("re-exports splitUnifiedDiffByFile from gh-pr-cli", async () => {
    const mod = await import("@/lib/gh-pr-cli");
    expect(typeof mod.splitUnifiedDiffByFile).toBe("function");
  });

  test("diffBranch: 2 modified + 1 added, uses triple-dot range, populates headSha", async () => {
    const range = "main...feature";
    const numstat = [
      "5\t2\tsrc/a.ts",
      "1\t1\tsrc/b.ts",
      "10\t0\tsrc/c.ts",
    ].join("\n");
    const nameStatus = [
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      "A\tsrc/c.ts",
    ].join("\n");
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1..2 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      "diff --git a/src/c.ts b/src/c.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/c.ts",
      "@@ -0,0 +1,1 @@",
      "+hello",
    ].join("\n");

    installRouter([
      {
        match: (a) =>
          a.includes("--numstat") && a.includes(range),
        stdout: numstat,
      },
      {
        match: (a) =>
          a.includes("--name-status") && a.includes(range),
        stdout: nameStatus,
      },
      {
        match: (a) =>
          a[0] === "-C" &&
          a[2] === "diff" &&
          a.length === 4 &&
          a[3] === range,
        stdout: patch,
      },
      {
        match: (a) => a.includes("rev-parse") && a.includes("feature"),
        stdout: "abc123def456\n",
      },
    ]);

    const { diffBranch } = await import("@/lib/git-diff-cli");
    const res = await diffBranch({
      repoPath: "/repo",
      base: "main",
      ref: "feature",
    });

    expect(res.base).toBe("main");
    expect(res.ref).toBe("feature");
    expect(res.headSha).toBe("abc123def456");
    expect(res.files).toHaveLength(3);

    const a = res.files.find((f) => f.path === "src/a.ts")!;
    expect(a.status).toBe("modified");
    expect(a.additions).toBe(5);
    expect(a.deletions).toBe(2);
    expect(a.patch).toContain("@@ -1,2 +1,2 @@");

    const b = res.files.find((f) => f.path === "src/b.ts")!;
    expect(b.status).toBe("modified");
    expect(b.additions).toBe(1);
    expect(b.patch).toBeNull();

    const c = res.files.find((f) => f.path === "src/c.ts")!;
    expect(c.status).toBe("added");
    expect(c.additions).toBe(10);
    expect(c.deletions).toBe(0);
    expect(c.patch).toContain("+hello");

    // Verify args used `<base>...<ref>` (not `<base>`)
    const calls = mockedExecFile.mock.calls;
    const diffCalls = calls.filter(
      (c) => Array.isArray(c[1]) && c[1].includes("diff"),
    );
    for (const dc of diffCalls) {
      const args = dc[1] as string[];
      expect(args.some((a) => a === range)).toBe(true);
      expect(args.some((a) => a === "main" && !a.includes("..."))).toBe(false);
    }
  });

  test("diffWorkingTree: uses plain <base>, ref is WORKING_TREE, headSha from HEAD", async () => {
    installRouter([
      {
        match: (a) => a.includes("--numstat"),
        stdout: "3\t1\tfile.ts",
      },
      {
        match: (a) => a.includes("--name-status"),
        stdout: "M\tfile.ts",
      },
      {
        match: (a) =>
          a[0] === "-C" &&
          a[2] === "diff" &&
          a.length === 4 &&
          a[3] === "main",
        stdout: "",
      },
      {
        match: (a) => a.includes("rev-parse") && a.includes("HEAD"),
        stdout: "headsha000\n",
      },
    ]);

    const { diffWorkingTree } = await import("@/lib/git-diff-cli");
    const res = await diffWorkingTree({
      repoPath: "/repo",
      base: "main",
    });

    expect(res.ref).toBe("WORKING_TREE");
    expect(res.headSha).toBe("headsha000");
    expect(res.files).toHaveLength(1);
    expect(res.files[0].path).toBe("file.ts");
    expect(res.files[0].additions).toBe(3);

    // Assert that NO call uses `main...HEAD` or any triple-dot range
    const calls = mockedExecFile.mock.calls;
    for (const c of calls) {
      const args = c[1] as string[];
      for (const a of args) {
        expect(a).not.toMatch(/\.\.\./);
      }
    }
    // Assert at least one diff call uses plain `main`
    const sawPlainBase = calls.some((c) => {
      const args = c[1] as string[];
      return (
        args[0] === "-C" &&
        args[2] === "diff" &&
        args.includes("main")
      );
    });
    expect(sawPlainBase).toBe(true);
  });

  test("rename detection: name-status R100 yields renamed status with new path", async () => {
    installRouter([
      {
        match: (a) => a.includes("--numstat"),
        stdout: "2\t2\told.ts\tnew.ts",
      },
      {
        match: (a) => a.includes("--name-status"),
        stdout: "R100\told.ts\tnew.ts",
      },
      {
        match: (a) => a[2] === "diff" && a.length === 4,
        stdout: "",
      },
      {
        match: (a) => a.includes("rev-parse"),
        stdout: "sha\n",
      },
    ]);

    const { diffBranch } = await import("@/lib/git-diff-cli");
    const res = await diffBranch({
      repoPath: "/repo",
      base: "main",
      ref: "feat",
    });

    expect(res.files).toHaveLength(1);
    expect(res.files[0].path).toBe("new.ts");
    expect(res.files[0].status).toBe("renamed");
    expect(res.files[0].additions).toBe(2);
    expect(res.files[0].deletions).toBe(2);
  });

  test("binary file: numstat dashes -> additions/deletions are 0", async () => {
    installRouter([
      {
        match: (a) => a.includes("--numstat"),
        stdout: "-\t-\timg.png",
      },
      {
        match: (a) => a.includes("--name-status"),
        stdout: "M\timg.png",
      },
      {
        match: (a) => a[2] === "diff" && a.length === 4,
        stdout: "",
      },
      {
        match: (a) => a.includes("rev-parse"),
        stdout: "sha\n",
      },
    ]);

    const { diffBranch } = await import("@/lib/git-diff-cli");
    const res = await diffBranch({
      repoPath: "/repo",
      base: "main",
      ref: "feat",
    });

    expect(res.files).toHaveLength(1);
    expect(res.files[0].path).toBe("img.png");
    expect(res.files[0].additions).toBe(0);
    expect(res.files[0].deletions).toBe(0);
    expect(res.files[0].patch).toBeNull();
  });

  test("status letter mapping: A/M/D/R/unknown", async () => {
    installRouter([
      {
        match: (a) => a.includes("--numstat"),
        stdout: [
          "1\t0\ta.ts",
          "1\t1\tm.ts",
          "0\t1\td.ts",
          "1\t1\told.ts\tr.ts",
          "1\t1\tx.ts",
        ].join("\n"),
      },
      {
        match: (a) => a.includes("--name-status"),
        stdout: [
          "A\ta.ts",
          "M\tm.ts",
          "D\td.ts",
          "R75\told.ts\tr.ts",
          "X\tx.ts",
        ].join("\n"),
      },
      {
        match: (a) => a[2] === "diff" && a.length === 4,
        stdout: "",
      },
      {
        match: (a) => a.includes("rev-parse"),
        stdout: "sha\n",
      },
    ]);

    const { diffBranch } = await import("@/lib/git-diff-cli");
    const res = await diffBranch({
      repoPath: "/repo",
      base: "main",
      ref: "feat",
    });

    const byPath = Object.fromEntries(res.files.map((f) => [f.path, f.status]));
    expect(byPath["a.ts"]).toBe("added");
    expect(byPath["m.ts"]).toBe("modified");
    expect(byPath["d.ts"]).toBe("removed");
    expect(byPath["r.ts"]).toBe("renamed");
    expect(byPath["x.ts"]).toBe("modified");
  });
});
