import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildCliAttempts, buildCliSystemPrompt } from "@/lib/cli-runner";

describe("buildCliAttempts", () => {
  test("uses AGX wrappers for Claude chat execution when both AGX entrypoints are available", () => {
    const homeDir = os.homedir();
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

    expect(attempts).toHaveLength(3);
    expect(attempts[0]).toMatchObject({
      command: process.execPath,
      parser: "claude-stream-json",
    });
    expect(attempts[0]?.args).toContain("--add-dir");
    expect(attempts[0]?.args).toContain(homeDir);
    expect(attempts[0]?.args).toContain("--verbose");
    expect(attempts[1]).toMatchObject({
      command: "agx",
      parser: "claude-stream-json",
    });
    expect(attempts[1]?.args).toContain("--add-dir");
    expect(attempts[1]?.args).toContain(homeDir);
    expect(attempts[1]?.args).toContain("--verbose");
    expect(attempts[2]).toMatchObject({
      command: "claude",
      parser: "claude-stream-json",
    });
    expect(attempts[2]?.args).toContain("--add-dir");
    expect(attempts[2]?.args).toContain(homeDir);
  });

  test("uses AGX wrappers when the system agx binary is unavailable but the bundled CLI exists", () => {
    const homeDir = os.homedir();
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
      parser: "claude-stream-json",
    });
    expect(attempts[0]?.args).toContain("--add-dir");
    expect(attempts[0]?.args).toContain(homeDir);
    expect(attempts[0]?.args).toContain("--verbose");
  });

  test("falls back to the native provider CLI when AGX entrypoints are unavailable", () => {
    const homeDir = os.homedir();
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
    expect(attempts[0]?.args).toContain("--dangerously-skip-permissions");
    expect(attempts[0]?.args).toContain("--add-dir");
    expect(attempts[0]?.args).toContain(homeDir);
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
    const homeDir = os.homedir();
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
      "--add-dir",
      homeDir,
      "--config",
      "profile=fast",
      "--approval-mode=manual",
      "--json",
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
      "--add-dir",
      homeDir,
      "--config",
      "profile=fast",
      "--approval-mode=manual",
      "--json",
    ]);
  });

  test("uses provider-native permission bypass flags for native fallbacks", () => {
    const homeDir = os.homedir();

    const claudeAttempts = buildCliAttempts(
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
    expect(claudeAttempts).toHaveLength(1);
    expect(claudeAttempts[0]?.args).toContain("--dangerously-skip-permissions");
    expect(claudeAttempts[0]?.args).toContain("--add-dir");
    expect(claudeAttempts[0]?.args).toContain(homeDir);

    const codexAttempts = buildCliAttempts(
      {
        provider: "codex",
        model: "gpt-5-codex",
        prompt: "Reply with OK.",
        systemPrompt: "You are Jane.",
      },
      {
        commandExists: (bin) => bin === "codex",
        bundledCliPath: null,
      }
    );
    expect(codexAttempts).toHaveLength(1);
    expect(codexAttempts[0]?.args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(codexAttempts[0]?.args).toContain("--add-dir");
    expect(codexAttempts[0]?.args).toContain(homeDir);

    const geminiAttempts = buildCliAttempts(
      {
        provider: "gemini",
        model: null,
        prompt: "Reply with OK.",
        systemPrompt: "You are Jane.",
      },
      {
        commandExists: (bin) => bin === "gemini",
        bundledCliPath: null,
      }
    );
    expect(geminiAttempts).toHaveLength(1);
    expect(geminiAttempts[0]?.args).toContain("--yolo");
    expect(geminiAttempts[0]?.args).toContain("--include-directories");
    expect(geminiAttempts[0]?.args).toContain(homeDir);
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
