/**
 * @jest-environment node
 */
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  loadRepoIndex,
  saveRepoIndex,
  scanForRepos,
  type RepoIndex,
} from "@/lib/git-repo-index";

async function mkdirp(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function makeRepo(dir: string, asFile = false) {
  await mkdirp(dir);
  const gitPath = path.join(dir, ".git");
  if (asFile) {
    await fs.writeFile(gitPath, "gitdir: /somewhere/else\n");
  } else {
    await mkdirp(gitPath);
  }
}

let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "git-repo-index-"));
});

afterEach(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("scanForRepos", () => {
  test("skips node_modules even if it contains a .git", async () => {
    await makeRepo(path.join(fixtureRoot, "node_modules", "fake-pkg"));
    await makeRepo(path.join(fixtureRoot, "real-repo"));

    const idx = await scanForRepos({ root: fixtureRoot, maxDepth: 5 });
    const paths = idx.entries.map((e) => e.path).sort();
    expect(paths).toEqual([path.join(fixtureRoot, "real-repo")]);
  });

  test("respects depth limit", async () => {
    // depth 3: fixtureRoot/a/b/c/.git -> at depth 3 from root
    await makeRepo(path.join(fixtureRoot, "a", "b", "c"));
    const shallow = await scanForRepos({ root: fixtureRoot, maxDepth: 2 });
    expect(shallow.entries).toHaveLength(0);
    const deep = await scanForRepos({ root: fixtureRoot, maxDepth: 3 });
    expect(deep.entries.map((e) => e.path)).toEqual([
      path.join(fixtureRoot, "a", "b", "c"),
    ]);
  });

  test("detects worktree-style repo where .git is a file", async () => {
    await makeRepo(path.join(fixtureRoot, "wt-repo"), true);
    const idx = await scanForRepos({ root: fixtureRoot, maxDepth: 5 });
    expect(idx.entries.map((e) => e.path)).toEqual([
      path.join(fixtureRoot, "wt-repo"),
    ]);
  });

  test("does not descend into a found repo", async () => {
    await makeRepo(path.join(fixtureRoot, "outer"));
    await makeRepo(path.join(fixtureRoot, "outer", "inner"));
    const idx = await scanForRepos({ root: fixtureRoot, maxDepth: 5 });
    expect(idx.entries.map((e) => e.path)).toEqual([
      path.join(fixtureRoot, "outer"),
    ]);
  });

  test("prunes dot dirs but allows .config", async () => {
    await makeRepo(path.join(fixtureRoot, ".cache", "thing"));
    await makeRepo(path.join(fixtureRoot, ".config", "thing"));
    const idx = await scanForRepos({ root: fixtureRoot, maxDepth: 5 });
    expect(idx.entries.map((e) => e.path)).toEqual([
      path.join(fixtureRoot, ".config", "thing"),
    ]);
  });

  test("sets scannedAt and discoveredAt", async () => {
    await makeRepo(path.join(fixtureRoot, "r"));
    const before = Date.now();
    const idx = await scanForRepos({ root: fixtureRoot, maxDepth: 5 });
    const after = Date.now();
    expect(idx.scannedAt).toBeGreaterThanOrEqual(before);
    expect(idx.scannedAt).toBeLessThanOrEqual(after);
    expect(idx.entries[0].discoveredAt).toBeGreaterThanOrEqual(before);
    expect(idx.entries[0].discoveredAt).toBeLessThanOrEqual(after);
  });
});

describe("ensureFreshRepoIndex", () => {
  let origHome: string | undefined;

  beforeEach(() => {
    origHome = process.env.HOME;
    process.env.HOME = fixtureRoot;
    jest.resetModules();
  });

  afterEach(() => {
    process.env.HOME = origHome;
  });

  test("returns { index: null, scanning: true } when no index exists, kicks off a scan", async () => {
    const mod = await import("@/lib/git-repo-index");
    let calls = 0;
    const scanner = async () => {
      calls += 1;
      return { entries: [], scannedAt: Date.now() };
    };
    const res = await mod.ensureFreshRepoIndex({ scanner });
    expect(res.index).toBeNull();
    expect(res.scanning).toBe(true);
    // Wait for in-flight scan to complete to avoid leaking state
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(calls).toBe(1);
    expect(mod.isScanning()).toBe(false);
  });

  test("returns { index: <fresh>, scanning: false } when index is fresh", async () => {
    const mod = await import("@/lib/git-repo-index");
    const fresh: RepoIndex = {
      entries: [{ path: "/a", discoveredAt: Date.now() }],
      scannedAt: Date.now(),
    };
    await mod.saveRepoIndex(fresh);
    let calls = 0;
    const scanner = async () => {
      calls += 1;
      return { entries: [], scannedAt: Date.now() };
    };
    const res = await mod.ensureFreshRepoIndex({ scanner });
    expect(res.index?.scannedAt).toBe(fresh.scannedAt);
    expect(res.scanning).toBe(false);
    expect(calls).toBe(0);
  });

  test("returns { index: <stale>, scanning: true } when index is stale, kicks off a scan", async () => {
    const mod = await import("@/lib/git-repo-index");
    const staleIdx: RepoIndex = {
      entries: [{ path: "/old", discoveredAt: 1 }],
      scannedAt: Date.now() - 2 * mod.RESCAN_TTL_MS,
    };
    await mod.saveRepoIndex(staleIdx);
    let calls = 0;
    const scanner = async () => {
      calls += 1;
      return { entries: [], scannedAt: Date.now() };
    };
    const res = await mod.ensureFreshRepoIndex({ scanner });
    expect(res.index?.scannedAt).toBe(staleIdx.scannedAt);
    expect(res.scanning).toBe(true);
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(calls).toBe(1);
  });

  test("concurrent calls share a single in-flight scan", async () => {
    const mod = await import("@/lib/git-repo-index");
    let calls = 0;
    let resolveScan!: (v: RepoIndex) => void;
    const scanner = () =>
      new Promise<RepoIndex>((resolve) => {
        calls += 1;
        resolveScan = resolve;
      });
    const r1 = await mod.ensureFreshRepoIndex({ scanner });
    const r2 = await mod.ensureFreshRepoIndex({ scanner });
    const r3 = await mod.ensureFreshRepoIndex({ scanner });
    expect(r1.scanning).toBe(true);
    expect(r2.scanning).toBe(true);
    expect(r3.scanning).toBe(true);
    expect(calls).toBe(1);
    resolveScan({ entries: [], scannedAt: Date.now() });
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(mod.isScanning()).toBe(false);
  });
});

describe("saveRepoIndex / loadRepoIndex", () => {
  test("saveRepoIndex round-trips with loadRepoIndex and is atomic", async () => {
    // Redirect HOME so REPO_INDEX_PATH resolves into our fixture dir
    const origHome = process.env.HOME;
    process.env.HOME = fixtureRoot;
    jest.resetModules();
    const mod = await import("@/lib/git-repo-index");
    const idx: RepoIndex = {
      entries: [{ path: "/a", discoveredAt: 1 }],
      scannedAt: 2,
    };
    await mod.saveRepoIndex(idx);
    // tmp must not exist
    await expect(fs.stat(`${mod.REPO_INDEX_PATH}.tmp`)).rejects.toThrow();
    const loaded = await mod.loadRepoIndex();
    expect(loaded).toEqual(idx);
    process.env.HOME = origHome;
  });

  test("loadRepoIndex returns null when file missing", async () => {
    process.env.HOME = fixtureRoot; // empty fixture
    jest.resetModules();
    const mod = await import("@/lib/git-repo-index");
    const loaded = await mod.loadRepoIndex();
    expect(loaded).toBeNull();
  });

  test("loadRepoIndex returns null on unparseable JSON", async () => {
    process.env.HOME = fixtureRoot;
    jest.resetModules();
    const mod = await import("@/lib/git-repo-index");
    await mkdirp(path.dirname(mod.REPO_INDEX_PATH));
    await fs.writeFile(mod.REPO_INDEX_PATH, "not json {");
    const loaded = await mod.loadRepoIndex();
    expect(loaded).toBeNull();
  });
});
