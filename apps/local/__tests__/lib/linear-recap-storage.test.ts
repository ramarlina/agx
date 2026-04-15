/**
 * @jest-environment node
 */

import fs from "fs";
import os from "os";
import path from "path";

describe("linear-recap/storage", () => {
  let tmpDir: string;

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-recap-test-"));
    process.env.AGX_HOME = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.AGX_HOME;
  });

  test("writeRecap writes a timestamped file and updates latest.md symlink", async () => {
    const { writeRecap, readLatestRecap } = await import(
      "@/src/linear-recap/storage"
    );

    const result = await writeRecap("issue-1", "# Hello\n\nBody");

    expect(result.filePath).toMatch(/issue-1\/recaps\/.+\.md$/);
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(fs.readFileSync(result.filePath, "utf8")).toBe("# Hello\n\nBody");

    const latest = await readLatestRecap("issue-1");
    expect(latest).not.toBeNull();
    expect(latest?.content).toBe("# Hello\n\nBody");
    expect(latest?.filePath).toMatch(/latest\.md$/);
    expect(typeof latest?.generatedAt.getTime).toBe("function");
  });

  test("writeRecap prunes to the 10 most recent files", async () => {
    const { writeRecap } = await import("@/src/linear-recap/storage");

    for (let i = 0; i < 12; i++) {
      await writeRecap("issue-2", `recap ${i}`);
      await new Promise((r) => setTimeout(r, 5));
    }

    const dir = path.join(tmpDir, "linear", "issue-2", "recaps");
    const files = fs
      .readdirSync(dir)
      .filter((name) => name !== "latest.md");
    expect(files.length).toBeLessThanOrEqual(10);
  });

  test("readLatestRecap returns null when no file exists", async () => {
    const { readLatestRecap } = await import("@/src/linear-recap/storage");
    const result = await readLatestRecap("issue-404");
    expect(result).toBeNull();
  });
});
