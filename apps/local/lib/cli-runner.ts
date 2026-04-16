import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import type { ChatProvider } from "./types";
import { createCliChunkSanitizer } from "./sanitize";
import { writeDebugLog } from "./debug-log";
import { buildSpawnEnv, commandExists } from "./shell-env";
import { buildScheduledTaskSkillPromptContext } from "./scheduled-task-skill";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export class CliRunError extends Error {
  exitCode: number | null;
  logs: string;
  constructor(message: string, exitCode: number | null, logs: string) {
    super(message);
    this.name = "CliRunError";
    this.exitCode = exitCode;
    this.logs = logs;
  }
}

// Stream parsers

type StreamParser = {
  push: (chunk: string) => void;
  flush: () => void;
};

const createRawParser = (onDelta: (chunk: string) => void): StreamParser => ({
  push: onDelta,
  flush: () => {},
});

const extractClaudeAssistantText = (record: any): string => {
  if (!record || typeof record !== "object") return "";
  if (record.type === "assistant") {
    const content = Array.isArray(record?.message?.content)
      ? record.message.content
      : [];
    return content
      .flatMap((part: any) =>
        part?.type === "text" && isNonEmptyString(part.text) ? [part.text] : []
      )
      .join("");
  }
  const event = record?.event;
  if (
    record.type === "stream_event" &&
    event?.type === "content_block_delta" &&
    event?.delta?.type === "text_delta" &&
    isNonEmptyString(event?.delta?.text)
  ) {
    return event.delta.text;
  }
  return "";
};

const createClaudeStreamJsonParser = (
  onDelta: (chunk: string) => void
): StreamParser => {
  let buffer = "";
  let emittedCharacters = 0;
  let sawJson = false;

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed);
      sawJson = true;
      const delta = extractClaudeAssistantText(parsed);
      if (!delta) return;
      if (parsed?.type === "assistant" && emittedCharacters > 0) return;
      emittedCharacters += delta.length;
      onDelta(delta);
    } catch {
      if (!sawJson) onDelta(`${line}\n`);
    }
  };

  return {
    push: (chunk: string) => {
      buffer += chunk;
      while (true) {
        const i = buffer.indexOf("\n");
        if (i === -1) break;
        processLine(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
      }
    },
    flush: () => {
      if (buffer.trim()) processLine(buffer);
      buffer = "";
    },
  };
};

const createGeminiStreamJsonParser = (
  onDelta: (chunk: string) => void
): StreamParser => {
  let buffer = "";
  let sawJson = false;
  let accumulatedAssistantText = "";

  const emitGeminiText = (text: string, isDelta: boolean) => {
    if (!text) return;
    if (isDelta) {
      if (accumulatedAssistantText && text.startsWith(accumulatedAssistantText)) {
        const suffix = text.slice(accumulatedAssistantText.length);
        if (suffix) onDelta(suffix);
        accumulatedAssistantText = text;
        return;
      }
      onDelta(text);
      accumulatedAssistantText += text;
      return;
    }
    if (accumulatedAssistantText && text.startsWith(accumulatedAssistantText)) {
      const suffix = text.slice(accumulatedAssistantText.length);
      if (suffix) onDelta(suffix);
      accumulatedAssistantText = text;
      return;
    }
    if (!accumulatedAssistantText) {
      onDelta(text);
      accumulatedAssistantText = text;
    }
  };

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed);
      sawJson = true;
      if (
        parsed?.type === "message" &&
        parsed?.role === "assistant" &&
        isNonEmptyString(parsed?.content)
      ) {
        emitGeminiText(parsed.content, parsed?.delta === true);
      }
    } catch {
      if (!sawJson) onDelta(`${line}\n`);
    }
  };

  return {
    push: (chunk: string) => {
      buffer += chunk;
      while (true) {
        const i = buffer.indexOf("\n");
        if (i === -1) break;
        processLine(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
      }
    },
    flush: () => {
      if (buffer.trim()) processLine(buffer);
      buffer = "";
    },
  };
};

const extractCodexAssistantText = (record: any): string => {
  if (!record || typeof record !== "object") return "";
  if (
    record.type === "item.completed" &&
    record.item?.type === "agent_message" &&
    isNonEmptyString(record.item?.text)
  ) {
    return record.item.text;
  }
  if (
    record.type === "item.delta" &&
    record.item?.type === "agent_message" &&
    isNonEmptyString(record.delta?.text)
  ) {
    return record.delta.text;
  }
  return "";
};

const createCodexJsonParser = (
  onDelta: (chunk: string) => void
): StreamParser => {
  let buffer = "";
  let sawJson = false;
  const completedItems = new Set<string>();

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed);
      sawJson = true;
      if (
        parsed?.type === "item.completed" &&
        isNonEmptyString(parsed?.item?.id)
      ) {
        if (completedItems.has(parsed.item.id)) return;
        completedItems.add(parsed.item.id);
      }
      const delta = extractCodexAssistantText(parsed);
      if (delta) onDelta(delta);
    } catch {
      if (!sawJson) onDelta(`${line}\n`);
    }
  };

  return {
    push: (chunk: string) => {
      buffer += chunk;
      while (true) {
        const i = buffer.indexOf("\n");
        if (i === -1) break;
        processLine(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
      }
    },
    flush: () => {
      if (buffer.trim()) processLine(buffer);
      buffer = "";
    },
  };
};

const createThoughtFilterParser = (
  inner: StreamParser,
  onThought?: (content: string) => void
): StreamParser => {
  let buffer = "";
  let inThought = false;
  let thoughtStarted = false;
  let thoughtContent = "";

  const THINK_START_PATTERNS = [
    /^Thinking\.\.\./,
    /^<think>/i,
  ];
  const THINK_END_PATTERNS = [
    /\.\.\.done thinking\.?\s*/,
    /<\/think>/i,
  ];

  const processBuffer = () => {
    while (buffer.length > 0) {
      if (inThought) {
        // Look for end-of-thought markers
        let endIdx = -1;
        let endLen = 0;
        for (const pat of THINK_END_PATTERNS) {
          const match = buffer.match(pat);
          if (match && match.index !== undefined) {
            const candidate = match.index + match[0].length;
            if (endIdx === -1 || match.index < endIdx) {
              endIdx = match.index;
              endLen = match[0].length;
            }
          }
        }
        if (endIdx !== -1) {
          // Capture thought content before the end marker
          thoughtContent += buffer.slice(0, endIdx);
          if (onThought && thoughtContent.trim()) {
            onThought(thoughtContent.trim());
          }
          thoughtContent = "";
          // Skip everything up to and including the end marker
          buffer = buffer.slice(endIdx + endLen);
          inThought = false;
          // Trim leading whitespace/newlines after thought block
          buffer = buffer.replace(/^\s*\n*/, "");
          continue;
        }
        // Haven't found end yet — accumulate thought content, keep buffering
        thoughtContent += buffer;
        buffer = "";
        return;
      }

      // Not in thought — check for start markers
      for (const pat of THINK_START_PATTERNS) {
        const match = buffer.match(pat);
        if (match && match.index !== undefined) {
          // Emit everything before the thought start
          const before = buffer.slice(0, match.index);
          if (before) inner.push(before);
          buffer = buffer.slice(match.index + match[0].length);
          inThought = true;
          thoughtStarted = true;
          thoughtContent = "";
          break;
        }
      }

      if (inThought) continue;

      // No thought marker found — safe to emit most of buffer
      // Keep a small tail in case a marker is split across chunks
      const safeLen = Math.max(0, buffer.length - 30);
      if (safeLen > 0) {
        inner.push(buffer.slice(0, safeLen));
        buffer = buffer.slice(safeLen);
      }
      return;
    }
  };

  return {
    push: (chunk: string) => {
      buffer += chunk;
      processBuffer();
    },
    flush: () => {
      // If stuck in thought at end, discard remaining thought
      if (!inThought && buffer) {
        inner.push(buffer);
      }
      buffer = "";
      inner.flush();
    },
  };
};

// Command builders

// Keep chat execution on the AGX wrapper for providers AGX knows about.
// Do not add direct provider attempts for these unless AGX itself loses the
// ability to launch that provider. The wrapper is where unattended behavior,
// approval bypass mapping, and future safety policy live.
const AGX_WRAPPED_PROVIDERS: ReadonlySet<ChatProvider> = new Set([
  "claude",
  "gemini",
  "ollama",
  "codex",
]);

function providerNativeCommand({
  provider,
  model,
  prompt,
  systemPrompt,
}: {
  provider: ChatProvider;
  model: string | null;
  prompt: string;
  systemPrompt?: string;
}): {
  command: string;
  args: string[];
  parser: "raw" | "claude-stream-json" | "codex-json" | "gemini-stream-json";
  filterThoughts?: boolean;
  env?: Record<string, string>;
} | null {
  switch (provider) {
    case "claude": {
      const args = [
        "-p",
        "--verbose",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
      ];
      if (model) args.push("--model", model);
      if (systemPrompt) args.push("--system-prompt", systemPrompt);
      args.push(prompt);
      return { command: "claude", args, parser: "claude-stream-json" };
    }
    case "gemini":
      return {
        command: "gemini",
        args: ["--yolo", "-p", systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt, "-o", "stream-json"],
        parser: "gemini-stream-json",
      };
    case "ollama":
      return {
        command: "ollama",
        args: ["run", model || "llama3.2", systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt],
        parser: "raw",
      };
    case "codex": {
      const codexArgs = ["exec", "--json"];
      if (model) codexArgs.push("--model", model);
      codexArgs.push(systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt);
      return {
        command: "codex",
        args: codexArgs,
        parser: "codex-json",
      };
    }
    case "zai": {
      // Z.AI exposes an Anthropic-compatible endpoint at https://api.z.ai/api/anthropic.
      // Runs `claude` with ANTHROPIC_BASE_URL override (same pattern as Ollama through agx).
      const zaiApiKey = process.env.ZAI_API_KEY?.trim();
      const zaiArgs = [
        "-p",
        "--verbose",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
      ];
      if (model) zaiArgs.push("--model", model);
      if (systemPrompt) zaiArgs.push("--system-prompt", systemPrompt);
      zaiArgs.push(prompt);
      return {
        command: "claude",
        args: zaiArgs,
        parser: "claude-stream-json",
        env: {
          ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
          ...(zaiApiKey ? { ANTHROPIC_AUTH_TOKEN: zaiApiKey } : {}),
        },
      };
    }
    default:
      return null;
  }
}

function agxStreamingPassthrough(provider: ChatProvider): {
  args: string[];
  parser: CliAttempt["parser"];
} {
  switch (provider) {
    case "claude":
      return { args: ["--output-format", "stream-json", "--include-partial-messages"], parser: "claude-stream-json" };
    case "gemini":
      return { args: ["-o", "stream-json"], parser: "gemini-stream-json" };
    case "codex":
      return { args: ["--json"], parser: "codex-json" };
    default:
      return { args: [], parser: "raw" };
  }
}

function agxCommandForProvider({
  provider,
  model,
  prompt,
  passthroughArgs,
}: {
  provider: ChatProvider;
  model: string | null;
  prompt: string;
  passthroughArgs?: string[];
}): CliAttempt {
  const args = [provider, "-y", "--print", "--prompt", prompt];
  if (model) args.push("--model", model);
  const streaming = agxStreamingPassthrough(provider);
  const allPassthrough = [...(passthroughArgs || []), ...streaming.args];
  if (allPassthrough.length > 0) {
    args.push("--", ...allPassthrough);
  }
  return { command: "agx", args, parser: streaming.parser };
}

function resolveBundledCliPath(): string | null {
  const explicit = process.env.AGX_CLI_PATH?.trim();
  if (explicit && fs.existsSync(explicit)) return explicit;

  const candidates = [
    path.resolve(process.cwd(), "..", "cli", "index.js"),
    path.resolve(__dirname, "..", "cli", "index.js"),
    path.resolve(process.execPath, "..", "..", "Resources", "cli", "index.js"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

type CliAttempt = {
  command: string;
  args: string[];
  parser: "raw" | "claude-stream-json" | "codex-json" | "gemini-stream-json";
  filterThoughts?: boolean;
  env?: Record<string, string>;
};

export function buildCliAttempts(
  {
    provider,
    model,
    prompt,
    systemPrompt,
    passthroughArgs,
  }: {
    provider: ChatProvider;
    model: string | null;
    prompt: string;
    systemPrompt?: string;
    passthroughArgs?: string[];
  },
  deps: {
    commandExists?: (bin: string) => boolean;
    bundledCliPath?: string | null;
  } = {}
): CliAttempt[] {
  const exists = deps.commandExists ?? commandExists;
  const bundledCliPath =
    deps.bundledCliPath === undefined ? resolveBundledCliPath() : deps.bundledCliPath;
  const attempts: CliAttempt[] = [];

  const agxPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  if (AGX_WRAPPED_PROVIDERS.has(provider)) {
    // If the AGX wrapper does not expose a provider-specific flag yet, pass it
    // through after `--` instead of reintroducing direct provider execution here.
    const bundledAgx = bundledAgxCommandForProvider({
      provider,
      model,
      prompt: agxPrompt,
      cliPath: bundledCliPath,
      passthroughArgs,
    });
    if (bundledAgx) {
      attempts.push(bundledAgx);
    }

    if (exists("agx")) {
      attempts.push(
        agxCommandForProvider({
          provider,
          model,
          prompt: agxPrompt,
          passthroughArgs,
        })
      );
    }

    const nativeAttempt = providerNativeCommand({
      provider,
      model,
      prompt,
      systemPrompt,
    });
    if (nativeAttempt && exists(nativeAttempt.command)) {
      // Fresh machines often have the provider CLI installed before AGX itself
      // is bundled or added to PATH, so keep a native fallback behind the wrappers.
      attempts.push(nativeAttempt);
    }

    return attempts;
  }

  const nativeAttempt = providerNativeCommand({
    provider,
    model,
    prompt,
    systemPrompt,
  });
  if (nativeAttempt && exists(nativeAttempt.command)) {
    attempts.push(nativeAttempt);
  }

  return attempts;
}

function bundledAgxCommandForProvider({
  provider,
  model,
  prompt,
  cliPath,
  passthroughArgs,
}: {
  provider: ChatProvider;
  model: string | null;
  prompt: string;
  cliPath?: string | null;
  passthroughArgs?: string[];
}): CliAttempt | null {
  const resolvedCliPath = cliPath === undefined ? resolveBundledCliPath() : cliPath;
  if (!resolvedCliPath) return null;

  const args = [resolvedCliPath, provider, "-y", "--print", "--prompt", prompt];
  if (model) args.push("--model", model);
  const streaming = agxStreamingPassthrough(provider);
  const allPassthrough = [...(passthroughArgs || []), ...streaming.args];
  if (allPassthrough.length > 0) {
    args.push("--", ...allPassthrough);
  }
  return { command: process.execPath, args, parser: streaming.parser };
}

// Core runner

async function runCommandStreamed({
  command,
  args,
  timeoutMs,
  signal,
  onDelta,
  onLog,
  onSpawn,
  env: extraEnv,
}: {
  command: string;
  args: string[];
  timeoutMs: number;
  signal?: AbortSignal;
  onDelta: (chunk: string) => void;
  onLog?: (stream: "stdout" | "stderr", line: string) => void;
  onSpawn?: (pid: number) => void;
  env?: Record<string, string>;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    writeDebugLog("cli-runner.spawn", {
      command,
      args,
      timeoutMs,
      bundledCliPath: resolveBundledCliPath(),
      isElectron: process.env.AGX_ELECTRON || null,
    });
    if (onLog) onLog("stderr", `$ ${command} ${args.map(a => a.length > 80 ? a.slice(0, 80) + '…' : a).join(' ')}\n`);
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: buildSpawnEnv(extraEnv),
    });

    let done = false;
    let combinedOutput = "";
    let timedOut = false;

    const finalize = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };

    const onAbort = () => {
      writeDebugLog("cli-runner.abort", {
        command,
        args,
        pid: child.pid ?? null,
      });
      child.kill("SIGTERM");
      finalize(new Error("Chat request aborted."));
    };

    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    if (onSpawn && child.pid) onSpawn(child.pid);
    writeDebugLog("cli-runner.spawned", {
      command,
      args,
      pid: child.pid ?? null,
    });

    let lastActivityAt = Date.now();

    const timer = setTimeout(() => {
      timedOut = true;
      writeDebugLog("cli-runner.timeout", {
        command,
        args,
        pid: child.pid ?? null,
        timeoutMs,
      });
      child.kill("SIGKILL");
      const tailLines = combinedOutput.split("\n").slice(-50).join("\n");
      const idleSec = Math.round((Date.now() - lastActivityAt) / 1000);
      finalize(new CliRunError(
        `CLI request timed out after ${timeoutMs}ms. Last output ${idleSec}s ago. Signal: SIGKILL.`,
        null,
        tailLines,
      ));
    }, timeoutMs);

    child.stdout.on("data", (data) => {
      const chunk = data.toString();
      combinedOutput += chunk;
      lastActivityAt = Date.now();
      onDelta(chunk);
      if (onLog) onLog("stdout", chunk);
    });

    child.stderr.on("data", (data) => {
      const str = data.toString();
      combinedOutput += str;
      lastActivityAt = Date.now();
      if (onLog) onLog("stderr", str);
    });

    child.on("error", (error) => {
      writeDebugLog("cli-runner.process_error", {
        command,
        args,
        pid: child.pid ?? null,
        error,
      });
      finalize(error);
    });

    child.on("close", (code, childSignal) => {
      if (done || timedOut) return;
      writeDebugLog("cli-runner.close", {
        command,
        args,
        pid: child.pid ?? null,
        code: code ?? null,
        signal: childSignal ?? null,
      });
      if (code === 0) {
        finalize();
        return;
      }
      const tailLines = combinedOutput.split("\n").slice(-50).join("\n");
      finalize(
        new CliRunError(
          `CLI command failed (exit=${code ?? "unknown"} signal=${childSignal ?? "none"}).`,
          code ?? null,
          tailLines,
        )
      );
    });
  });
}

export async function runCliResponse({
  provider,
  model,
  prompt,
  identity,
  self,
  skills,
  systemContext,
  passthroughArgs,
  signal,
  onDelta,
  onThought,
  onLog,
  onSpawn,
}: {
  provider: ChatProvider;
  model: string | null;
  prompt: string;
  identity?: string;
  self?: string;
  skills?: string;
  systemContext?: string;
  passthroughArgs?: string[];
  signal?: AbortSignal;
  onDelta: (chunk: string) => void;
  onThought?: (content: string) => void;
  onLog?: (stream: "stdout" | "stderr", line: string) => void;
  onSpawn?: (pid: number) => void;
}): Promise<void> {
  const timeoutMs = 30 * 60_000;
  const sanitize = createCliChunkSanitizer();
  const wrappedOnDelta = (chunk: string) => {
    const cleaned = sanitize(chunk);
    if (cleaned) onDelta(cleaned);
  };

  const systemPrompt = buildCliSystemPrompt({
    identity,
    self,
    skills,
    systemContext,
  });
  const attempts = buildCliAttempts({
    provider,
    model,
    prompt,
    systemPrompt,
    passthroughArgs,
  });

  if (attempts.length === 0) {
    writeDebugLog("cli-runner.no_attempts", {
      provider,
      model,
      bundledCliPath: resolveBundledCliPath(),
      isElectron: process.env.AGX_ELECTRON || null,
    });
    throw new Error(
      `No CLI runner available for provider "${provider}". Install agx or provider CLI.`
    );
  }

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    writeDebugLog("cli-runner.attempt", {
      provider,
      model,
      command: attempt.command,
      args: attempt.args,
      parser: attempt.parser,
    });
    const baseParser =
      attempt.parser === "claude-stream-json"
        ? createClaudeStreamJsonParser(wrappedOnDelta)
        : attempt.parser === "codex-json"
          ? createCodexJsonParser(wrappedOnDelta)
          : attempt.parser === "gemini-stream-json"
            ? createGeminiStreamJsonParser(wrappedOnDelta)
            : createRawParser(wrappedOnDelta);
    const parser = attempt.filterThoughts
      ? createThoughtFilterParser(baseParser, onThought)
      : baseParser;

    try {
      await runCommandStreamed({
        command: attempt.command,
        args: attempt.args,
        timeoutMs,
        signal,
        onDelta: parser.push,
        onLog,
        onSpawn,
        env: attempt.env,
      });
      parser.flush();
      writeDebugLog("cli-runner.success", {
        provider,
        model,
        command: attempt.command,
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      writeDebugLog("cli-runner.failure", {
        provider,
        model,
        command: attempt.command,
        error: lastError,
      });
    }
  }

  throw lastError || new Error("CLI execution failed.");
}

export function buildCliSystemPrompt({
  identity,
  self,
  skills,
  systemContext,
}: {
  identity?: string;
  self?: string;
  skills?: string;
  systemContext?: string;
}): string | undefined {
  const systemParts: string[] = [];
  if (systemContext) systemParts.push(systemContext);
  systemParts.push(buildScheduledTaskSkillPromptContext());
  if (identity) systemParts.push(`<identity>\n${identity}\n</identity>`);
  if (self) systemParts.push(`<self>\n${self}\n</self>`);
  if (skills) systemParts.push(`<skills>\n${skills}\n</skills>`);
  return systemParts.length > 0 ? systemParts.join("\n\n") : undefined;
}
