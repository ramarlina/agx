/**
 * @jest-environment node
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildScheduledTaskSkillContent,
  buildScheduledTaskSkillPromptContext,
  ensureScheduledTaskSkillInstalled,
  getScheduledTaskSkillPath,
} from "@/lib/scheduled-task-skill";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agx-scheduled-task-skill-"));
}

describe("scheduled task skill", () => {
  let agxDataDir: string;

  beforeEach(() => {
    agxDataDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(agxDataDir, { recursive: true, force: true });
  });

  test("installs the skill into the AGX data directory", () => {
    const workspaceRoot = "/tmp/agx-workspace";
    const skillPath = ensureScheduledTaskSkillInstalled({ agxDataDir, workspaceRoot });

    expect(skillPath).toBe(getScheduledTaskSkillPath({ agxDataDir }));
    expect(fs.existsSync(skillPath)).toBe(true);
    expect(fs.readFileSync(skillPath, "utf8")).toBe(buildScheduledTaskSkillContent({ workspaceRoot }));
    expect(fs.readFileSync(skillPath, "utf8")).toContain(
      "/tmp/agx-workspace/planning/automation-frontmatter-migration-spec.md",
    );
  });

  test("builds a prompt context that points agents at the installed skill", () => {
    const promptContext = buildScheduledTaskSkillPromptContext({
      agxDataDir,
      workspaceRoot: "/tmp/agx-workspace",
    });

    expect(promptContext).toContain("<scheduled-task-skill>");
    expect(promptContext).toContain(getScheduledTaskSkillPath({ agxDataDir }).replace(/\\/g, "/"));
    expect(promptContext).toContain("scheduled tasks, automations, prompt jobs");
  });
});
