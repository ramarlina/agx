/**
 * @jest-environment node
 */

import fs from "fs";
import os from "os";
import path from "path";

import {
  AutomationRepository,
  automationRecordToGraphSchedule,
  getDefaultAutomationsDir,
  parseAutomationMarkdown,
  resolvePromptFromDefinition,
  serializeAutomationDefinition,
} from "@/src/automations";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agx-automations-repo-"));
}

function buildPromptDefinition(id = "daily-review") {
  return {
    id,
    name: "Daily review",
    description: "Review inbox threads",
    projectId: "proj-1",
    state: "active" as const,
    trigger: {
      type: "scheduled" as const,
      cadence: "Weekdays at 9 AM",
      cronExpr: "0 9 * * 1-5",
    },
    execution: {
      overlapPolicy: "skip" as const,
      catchUpPolicy: "fire_once" as const,
      cancelCheckSec: 5,
    },
    target: {
      type: "prompt_job" as const,
      provider: "claude",
      model: "sonnet",
    },
    createdAt: "2026-04-07T18:00:00.000Z",
    body: "Summarize blockers and next actions.",
  };
}

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_AGX_AUTOMATIONS_DIR = process.env.AGX_AUTOMATIONS_DIR;
const ORIGINAL_AGX_DATA_DIR = process.env.AGX_DATA_DIR;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe("automation repository", () => {
  let rootDir: string;
  let repository: AutomationRepository;

  beforeEach(() => {
    rootDir = makeTempDir();
    repository = new AutomationRepository(rootDir);
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  test("serializer and parser round-trip a prompt-job definition", () => {
    const markdown = serializeAutomationDefinition(buildPromptDefinition());
    const parsed = parseAutomationMarkdown(markdown);

    expect(parsed).toMatchObject({
      id: "daily-review",
      name: "Daily review",
      description: "Review inbox threads",
      projectId: "proj-1",
      state: "active",
      trigger: {
        type: "scheduled",
        cadence: "Weekdays at 9 AM",
        cronExpr: "0 9 * * 1-5",
      },
      target: {
        type: "prompt_job",
        provider: "claude",
        model: "sonnet",
      },
    });
    expect(resolvePromptFromDefinition(parsed)).toBe("Summarize blockers and next actions.");
  });

  test("serializer and parser preserve objective metadata on prompt jobs", () => {
    const markdown = serializeAutomationDefinition({
      ...buildPromptDefinition("objective-review"),
      target: {
        ...buildPromptDefinition("objective-review").target,
        objectiveId: "objective-growth",
        objectiveKey: "growth-daily-visitors",
      },
    });
    const parsed = parseAutomationMarkdown(markdown);

    expect(parsed.target).toMatchObject({
      type: "prompt_job",
      objectiveId: "objective-growth",
      objectiveKey: "growth-daily-visitors",
    });
  });

  test("parser preserves sub-minute natural language cadences as interval schedules", () => {
    const parsed = parseAutomationMarkdown(`---
id: fast-monitor
name: Fast monitor
state: active
trigger:
  type: scheduled
  cadence: Every 15 seconds
target:
  type: execution_graph
  graphId: graph-fast
---
`);

    expect(parsed.trigger).toEqual({
      type: "scheduled",
      cadence: "Every 15 seconds",
      intervalMs: 15_000,
    });
  });

  test("parser rejects invalid state instead of defaulting to active", () => {
    expect(() => parseAutomationMarkdown(`---
id: invalid-state
name: Invalid state
state: enabled
trigger:
  type: scheduled
  cronExpr: "0 9 * * 1-5"
target:
  type: prompt_job
  provider: claude
---
Do the work.
`)).toThrow('Automation state must be one of "active", "paused", or "stopped".');
  });

  test("parser rejects missing trigger.type instead of assuming scheduled", () => {
    expect(() => parseAutomationMarkdown(`---
id: missing-trigger-type
name: Missing trigger type
state: active
trigger:
  cronExpr: "0 9 * * 1-5"
target:
  type: prompt_job
  provider: claude
---
Do the work.
`)).toThrow('Automation trigger.type must be "scheduled" or "condition".');
  });

  test("parser rejects invalid target.type instead of assuming prompt_job", () => {
    expect(() => parseAutomationMarkdown(`---
id: invalid-target-type
name: Invalid target type
state: active
trigger:
  type: scheduled
  cronExpr: "0 9 * * 1-5"
target:
  type: webhook
---
Do the work.
`)).toThrow('Automation target.type must be "prompt_job" or "execution_graph".');
  });

  test("repository supports create, update, archive, restore, and duplicate", () => {
    const created = repository.createAutomation(buildPromptDefinition());
    expect(created.definition.id).toBe("daily-review");
    expect(repository.getAutomation("daily-review")?.definition.name).toBe("Daily review");

    const updated = repository.updateAutomation("daily-review", {
      name: "Updated review",
      execution: { maxRuns: 10 },
    });
    expect(updated?.definition.name).toBe("Updated review");
    expect(updated?.definition.execution?.maxRuns).toBe(10);

    const archived = repository.archiveAutomation("daily-review");
    expect(archived?.archived).toBe(true);
    expect(repository.listVisibleAutomations()).toHaveLength(0);

    const restored = repository.restoreAutomation("daily-review");
    expect(restored?.archived).toBe(false);
    expect(repository.listVisibleAutomations()).toHaveLength(1);

    const duplicate = repository.duplicateAutomation("daily-review");
    expect(duplicate?.definition.id).toContain("daily-review-copy-");
    expect(repository.listVisibleAutomations()).toHaveLength(2);
  });

  test("due selection comes from sidecar state and schedule changes recompute nextRunAt", () => {
    repository.createAutomation(buildPromptDefinition());
    repository.updateAutomationState("daily-review", {
      nextRunAt: Date.now() - 5_000,
    });

    expect(repository.listDueAutomations().map((record) => record.definition.id)).toContain("daily-review");

    const changed = repository.updateAutomation("daily-review", {
      trigger: {
        type: "scheduled",
        cronExpr: "0 */6 * * *",
      },
    });

    expect(changed?.runtimeState.nextRunAt).toBeGreaterThan(Date.now());
    expect(repository.listDueAutomations().map((record) => record.definition.id)).not.toContain("daily-review");
  });

  test("definition updates advance runtime updatedAt", () => {
    repository.createAutomation(buildPromptDefinition());
    repository.updateAutomationState("daily-review", {
      updatedAt: "2020-01-01T00:00:00.000Z",
    });

    const updated = repository.updateAutomation("daily-review", {
      name: "New name",
    });

    expect(updated?.runtimeState.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
  });

  test("graph automation adapter preserves runtime schedule fields", () => {
    const record = repository.createAutomation({
      id: "graph-1",
      name: "Inbox monitor",
      state: "active",
      trigger: {
        type: "scheduled",
        cadence: "Every 15 seconds",
        intervalMs: 15_000,
      },
      execution: {
        maxRuns: 5,
        maxConsecutiveFailures: 2,
      },
      target: {
        type: "execution_graph",
        graphId: "graph-1",
        taskId: "task-1",
        resetNodeIds: ["run", "classify"],
        rootMessageId: "root-1",
      },
      createdAt: "2026-04-07T18:00:00.000Z",
      body: "",
    });

    const updated = repository.updateAutomationState(record.definition.id, {
      nextRunAt: 1770000000000,
      lastRunAt: 1769990000000,
      runCount: 12,
      consecutiveFailures: 1,
      tickInProgress: true,
    });

    const schedule = automationRecordToGraphSchedule(updated ?? record);
    expect(schedule).toMatchObject({
      intervalMs: 15_000,
      state: "active",
      resetNodeIds: ["run", "classify"],
      maxRuns: 5,
      runCount: 12,
      lastTickAt: 1769990000000,
      nextTickAt: 1770000000000,
      tickInProgress: true,
      rootMessageId: "root-1",
      consecutiveFailures: 1,
      maxConsecutiveFailures: 2,
      name: "Inbox monitor",
    });
  });
});

describe("automation storage defaults", () => {
  afterEach(() => {
    process.chdir(ORIGINAL_CWD);

    if (ORIGINAL_AGX_AUTOMATIONS_DIR === undefined) {
      delete process.env.AGX_AUTOMATIONS_DIR;
    } else {
      process.env.AGX_AUTOMATIONS_DIR = ORIGINAL_AGX_AUTOMATIONS_DIR;
    }

    if (ORIGINAL_AGX_DATA_DIR === undefined) {
      delete process.env.AGX_DATA_DIR;
    } else {
      process.env.AGX_DATA_DIR = ORIGINAL_AGX_DATA_DIR;
    }

    if (ORIGINAL_NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    }
  });

  test("defaults to AGX_DATA_DIR instead of the repo cwd", () => {
    const tempWorkspace = makeTempDir();
    const agxDataDir = makeTempDir();

    process.chdir(tempWorkspace);
    delete process.env.AGX_AUTOMATIONS_DIR;
    process.env.AGX_DATA_DIR = agxDataDir;
    process.env.NODE_ENV = "development";

    expect(getDefaultAutomationsDir()).toBe(path.join(agxDataDir, "automations"));

    fs.rmSync(tempWorkspace, { recursive: true, force: true });
    fs.rmSync(agxDataDir, { recursive: true, force: true });
  });

  test("repository migrates legacy repo-local automations into the stable store", () => {
    const tempWorkspace = makeTempDir();
    const agxDataDir = makeTempDir();
    const legacyRoot = path.join(tempWorkspace, "state", "automations");

    process.chdir(tempWorkspace);
    delete process.env.AGX_AUTOMATIONS_DIR;
    process.env.AGX_DATA_DIR = agxDataDir;
    process.env.NODE_ENV = "development";

    const legacyRepository = new AutomationRepository(legacyRoot);
    legacyRepository.createAutomation(buildPromptDefinition());

    const stableRepository = new AutomationRepository(getDefaultAutomationsDir());

    expect(stableRepository.getAutomation("daily-review")?.definition.name).toBe("Daily review");
    expect(
      fs.existsSync(path.join(getDefaultAutomationsDir(), "active", "daily-review.md")),
    ).toBe(true);

    fs.rmSync(tempWorkspace, { recursive: true, force: true });
    fs.rmSync(agxDataDir, { recursive: true, force: true });
  });
});
