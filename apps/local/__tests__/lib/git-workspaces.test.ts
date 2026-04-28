/**
 * @jest-environment node
 */
type ExecFileCb = (
  err: NodeJS.ErrnoException | null,
  result?: { stdout: string; stderr: string },
) => void;

const mockExecFile = jest.fn();

jest.mock("node:child_process", () => ({
  execFile: (
    cmd: string,
    args: string[],
    optsOrCb: unknown,
    maybeCb?: ExecFileCb,
  ) => {
    const cb = (typeof optsOrCb === "function" ? optsOrCb : maybeCb) as ExecFileCb;
    mockExecFile(cmd, args, (res: { stdout?: string; stderr?: string; error?: Error }) => {
      if (res?.error) cb(res.error as NodeJS.ErrnoException);
      else cb(null, { stdout: res?.stdout ?? "", stderr: res?.stderr ?? "" });
    });
  },
}));

import {
  listMatchingWorkspaces,
  getDefaultBranch,
} from "@/lib/git-workspaces";

interface Canned {
  stdout?: string;
  stderr?: string;
  error?: Error;
}

type Responder = (cmd: string, args: string[]) => Canned;

function setResponder(fn: Responder) {
  mockExecFile.mockImplementation(
    (cmd: string, args: string[], done: (res: Canned) => void) => {
      const res = fn(cmd, args);
      // mimic async
      setImmediate(() => done(res));
    },
  );
}

beforeEach(() => {
  mockExecFile.mockReset();
});

function isWorktreeList(args: string[]): boolean {
  return args.includes("worktree") && args.includes("list");
}
function isBranchList(args: string[]): boolean {
  return args[0] === "-C" && args[2] === "branch";
}
function isSymbolicRef(args: string[]): boolean {
  return args.includes("symbolic-ref");
}

describe("getDefaultBranch", () => {
  test("parses origin/main from symbolic-ref output", async () => {
    setResponder((cmd, args) => {
      expect(cmd).toBe("git");
      if (isSymbolicRef(args)) return { stdout: "refs/remotes/origin/main\n" };
      return { stdout: "" };
    });
    await expect(getDefaultBranch("/r")).resolves.toBe("main");
  });

  test("returns null when symbolic-ref fails", async () => {
    setResponder(() => ({ error: new Error("not a symbolic ref") }));
    await expect(getDefaultBranch("/r")).resolves.toBeNull();
  });
});

describe("listMatchingWorkspaces", () => {
  test("returns empty when ticketId is empty", async () => {
    const res = await listMatchingWorkspaces({
      repoPaths: ["/r1"],
      ticketId: "",
    });
    expect(res).toEqual([]);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  test("matches ticket id case-insensitively against branch and worktree path basename, dedupes worktree+branch", async () => {
    const repo = "/repo/a";
    const wt1 = "/wt/feature-ABC-123";
    const wt2 = "/wt/unrelated-zone";
    const worktreeOut = [
      `worktree ${repo}`,
      "HEAD aaaa",
      "branch refs/heads/main",
      "",
      `worktree ${wt1}`,
      "HEAD bbbb",
      "branch refs/heads/feature/abc-123-thing",
      "",
      `worktree ${wt2}`,
      "HEAD cccc",
      "branch refs/heads/random",
      "",
    ].join("\n");

    const branchOut = [
      "main\t*",
      "feature/abc-123-thing\t",
      "random\t",
      "no-match\t",
      "origin/main\t",
      "origin/HEAD -> origin/main\t",
      "origin/feature/ABC-123-other\t",
    ].join("\n");

    setResponder((_cmd, args) => {
      if (isWorktreeList(args)) return { stdout: worktreeOut };
      if (isBranchList(args)) return { stdout: branchOut };
      if (isSymbolicRef(args)) return { stdout: "refs/remotes/origin/main\n" };
      return { stdout: "" };
    });

    const res = await listMatchingWorkspaces({
      repoPaths: [repo],
      ticketId: "abc-123",
    });

    // Expect: dedup'd worktree row for wt1 (kind=worktree), and the remote-tracking branch ABC-123-other.
    const kinds = res.map((r) => `${r.kind}:${r.branch}`);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "worktree:feature/abc-123-thing",
        "branch:origin/feature/ABC-123-other",
      ]),
    );
    // No duplicate "branch:feature/abc-123-thing"
    expect(kinds).not.toContain("branch:feature/abc-123-thing");

    const wtRow = res.find((r) => r.kind === "worktree" && r.branch === "feature/abc-123-thing");
    expect(wtRow?.path).toBe(wt1);
    expect(wtRow?.isCheckedOut).toBe(true);
    expect(wtRow?.isCurrent).toBe(false);
    expect(wtRow?.defaultBranch).toBe("main");
    expect(wtRow?.repoPath).toBe(repo);

    // Make sure HEAD-alias remote is filtered out.
    expect(kinds.some((k) => k.includes("HEAD ->"))).toBe(false);
  });

  test("matches by worktree path basename when branch name doesn't contain ticket", async () => {
    const repo = "/repo/b";
    const wt = "/work/PROJ-7-fix";
    const worktreeOut = [
      `worktree ${repo}`,
      "HEAD aaaa",
      "branch refs/heads/main",
      "",
      `worktree ${wt}`,
      "HEAD bbbb",
      "branch refs/heads/some-name-without-id",
      "",
    ].join("\n");
    const branchOut = ["main\t*", "some-name-without-id\t"].join("\n");

    setResponder((_cmd, args) => {
      if (isWorktreeList(args)) return { stdout: worktreeOut };
      if (isBranchList(args)) return { stdout: branchOut };
      if (isSymbolicRef(args)) return { stdout: "refs/remotes/origin/main\n" };
      return { stdout: "" };
    });

    const res = await listMatchingWorkspaces({
      repoPaths: [repo],
      ticketId: "proj-7",
    });
    expect(res).toHaveLength(1);
    expect(res[0].kind).toBe("worktree");
    expect(res[0].path).toBe(wt);
  });

  test("isCurrent true for the worktree at repoPath itself", async () => {
    const repo = "/repo/c";
    const worktreeOut = [
      `worktree ${repo}`,
      "HEAD aaaa",
      "branch refs/heads/feat-xyz-9",
      "",
    ].join("\n");
    const branchOut = ["feat-xyz-9\t*"].join("\n");

    setResponder((_cmd, args) => {
      if (isWorktreeList(args)) return { stdout: worktreeOut };
      if (isBranchList(args)) return { stdout: branchOut };
      if (isSymbolicRef(args)) return { stdout: "refs/remotes/origin/main\n" };
      return { stdout: "" };
    });

    const res = await listMatchingWorkspaces({
      repoPaths: [repo],
      ticketId: "xyz-9",
    });
    expect(res).toHaveLength(1);
    expect(res[0].kind).toBe("worktree");
    expect(res[0].path).toBe(repo);
    expect(res[0].isCurrent).toBe(true);
    expect(res[0].isCheckedOut).toBe(true);
  });

  test("caps results at 200 across repos", async () => {
    const N = 150;
    const makeRepoOut = (idx: number) => {
      const lines: string[] = [];
      const repo = `/repo${idx}`;
      lines.push(`worktree ${repo}`, "HEAD aaaa", "branch refs/heads/main", "");
      return { repo, out: lines.join("\n") };
    };

    const branchOut = (idx: number) =>
      Array.from({ length: N }, (_, i) => `bug-${idx}-${i}\t`).join("\n");

    const repoPaths = ["/repo0", "/repo1", "/repo2"];
    setResponder((_cmd, args) => {
      const repoIdx = Number(args[1].replace("/repo", ""));
      if (isWorktreeList(args)) return { stdout: makeRepoOut(repoIdx).out };
      if (isBranchList(args)) return { stdout: branchOut(repoIdx) };
      if (isSymbolicRef(args)) return { stdout: "refs/remotes/origin/main\n" };
      return { stdout: "" };
    });

    const res = await listMatchingWorkspaces({
      repoPaths,
      ticketId: "bug-",
    });
    expect(res.length).toBe(200);
  });

  test("skips a failing repo silently and continues with others", async () => {
    const repoOk = "/repo/ok";
    const repoBad = "/repo/bad";
    setResponder((_cmd, args) => {
      // any call to repo/bad fails
      if (args[1] === repoBad) return { error: new Error("boom") };
      if (isWorktreeList(args)) {
        return {
          stdout: [
            `worktree ${repoOk}`,
            "HEAD aaaa",
            "branch refs/heads/ticket-77-impl",
            "",
          ].join("\n"),
        };
      }
      if (isBranchList(args)) return { stdout: "ticket-77-impl\t*\n" };
      if (isSymbolicRef(args)) return { stdout: "refs/remotes/origin/main\n" };
      return { stdout: "" };
    });

    const res = await listMatchingWorkspaces({
      repoPaths: [repoBad, repoOk],
      ticketId: "ticket-77",
    });
    expect(res).toHaveLength(1);
    expect(res[0].repoPath).toBe(repoOk);
  });

  test("getDefaultBranch null is propagated to entries", async () => {
    const repo = "/repo/d";
    setResponder((_cmd, args) => {
      if (isWorktreeList(args)) {
        return {
          stdout: [
            `worktree ${repo}`,
            "HEAD aaaa",
            "branch refs/heads/key-1",
            "",
          ].join("\n"),
        };
      }
      if (isBranchList(args)) return { stdout: "key-1\t*\n" };
      if (isSymbolicRef(args)) return { error: new Error("no remote") };
      return { stdout: "" };
    });
    const res = await listMatchingWorkspaces({
      repoPaths: [repo],
      ticketId: "key-1",
    });
    expect(res[0].defaultBranch).toBeNull();
  });

  test("detached worktree is included if path basename matches", async () => {
    const repo = "/repo/e";
    const wt = "/wt/TASK-5";
    setResponder((_cmd, args) => {
      if (isWorktreeList(args)) {
        return {
          stdout: [
            `worktree ${repo}`,
            "HEAD aaaa",
            "branch refs/heads/main",
            "",
            `worktree ${wt}`,
            "HEAD bbbb",
            "detached",
            "",
          ].join("\n"),
        };
      }
      if (isBranchList(args)) return { stdout: "main\t*\n" };
      if (isSymbolicRef(args)) return { stdout: "refs/remotes/origin/main\n" };
      return { stdout: "" };
    });
    const res = await listMatchingWorkspaces({
      repoPaths: [repo],
      ticketId: "task-5",
    });
    expect(res).toHaveLength(1);
    expect(res[0].kind).toBe("worktree");
    expect(res[0].path).toBe(wt);
    expect(res[0].branch).toBe("");
  });
});
