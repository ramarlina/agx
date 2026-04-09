import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildCliAttempts, buildCliSystemPrompt } from "@/lib/cli-runner";

describe("buildCliAttempts", () => {
  test("uses AGX wrappers for Claude chat execution when both AGX entrypoints are available", () => {
    const attempts = buildCliAttempts(
      {
        provider: "claude",
        model: "claude-opus-4-6",
        prompt: "Reply with OK.",
        systemPrompt: "You are Jane.",
      },
      {
        commandExists: (bin) => bin === "claude" || bin === "agx",
        bundledCliPath: "/tmp/agx-cli/index.js",
      }
    );

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      command: process.execPath,
      parser: "raw",
    });
    expect(attempts[1]).toMatchObject({
      command: "agx",
      parser: "raw",
    });
  });

  test("uses AGX wrappers when the system agx binary is unavailable but the bundled CLI exists", () => {
    const attempts = buildCliAttempts(
      {
        provider: "claude",
        model: "claude-opus-4-6",
        prompt: "Reply with OK.",
        systemPrompt: "You are Jane.",
      },
      {
        commandExists: () => false,
        bundledCliPath: "/tmp/agx-cli/index.js",
      }
    );

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      command: process.execPath,
      parser: "raw",
    });
  });

  test("falls back to the native provider CLI when AGX entrypoints are unavailable", () => {
    const attempts = buildCliAttempts(
      {
        provider: "claude",
        model: "claude-opus-4-6",
        prompt: "Reply with OK.",
        systemPrompt: "You are Jane.",
      },
      {
        commandExists: (bin) => bin === "claude",
        bundledCliPath: null,
      }
    );

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      command: "claude",
      parser: "claude-stream-json",
    });
  });

  test("keeps direct Claude-compatible execution for Z.AI because AGX has no zai provider wrapper", () => {
    const attempts = buildCliAttempts(
      {
        provider: "zai",
        model: "glm-4.7",
        prompt: "Reply with OK.",
        systemPrompt: "You are Jane.",
      },
      {
        commandExists: (bin) => bin === "claude" || bin === "agx",
        bundledCliPath: "/tmp/agx-cli/index.js",
      }
    );

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      command: "claude",
      parser: "claude-stream-json",
    });
  });

  test("passes through provider-specific args via AGX wrappers instead of using the provider directly", () => {
    const attempts = buildCliAttempts(
      {
        provider: "codex",
        model: "gpt-5-codex",
        prompt: "Reply with OK.",
        systemPrompt: "You are Jane.",
        passthroughArgs: ["--config", "profile=fast", "--approval-mode=manual"],
      },
      {
        commandExists: (bin) => bin === "agx",
        bundledCliPath: "/tmp/agx-cli/index.js",
      }
    );

    expect(attempts).toHaveLength(2);
    expect(attempts[0].args).toEqual([
      "/tmp/agx-cli/index.js",
      "codex",
      "-y",
      "--print",
      "--prompt",
      "You are Jane.\n\nReply with OK.",
      "--model",
      "gpt-5-codex",
      "--",
      "--config",
      "profile=fast",
      "--approval-mode=manual",
    ]);
    expect(attempts[1].args).toEqual([
      "codex",
      "-y",
      "--print",
      "--prompt",
      "You are Jane.\n\nReply with OK.",
      "--model",
      "gpt-5-codex",
      "--",
      "--config",
      "profile=fast",
      "--approval-mode=manual",
    ]);
  });

  test("injects the scheduled task skill path into the system prompt", () => {
    const agxDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-cli-runner-skill-"));
    const previousAgxDataDir = process.env.AGX_DATA_DIR;

    process.env.AGX_DATA_DIR = agxDataDir;

    try {
      const systemPrompt = buildCliSystemPrompt({
        systemContext: "Base system context.",
        identity: "You are Jane.",
      });

      expect(systemPrompt).toContain("Base system context.");
      expect(systemPrompt).toContain("You are Jane.");
      expect(systemPrompt).toContain(
        path.join(agxDataDir, "skills", "scheduled-task-manager", "SKILL.md").replace(/\\/g, "/"),
      );
      expect(systemPrompt).toContain("Read this skill whenever the task involves scheduled tasks");
    } finally {
      if (previousAgxDataDir === undefined) {
        delete process.env.AGX_DATA_DIR;
      } else {
        process.env.AGX_DATA_DIR = previousAgxDataDir;
      }
      fs.rmSync(agxDataDir, { recursive: true, force: true });
    }
  });
});
