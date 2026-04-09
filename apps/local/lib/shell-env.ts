import { spawnSync } from "child_process";

let cachedLoginShellPath: string | null | undefined;

function getLoginShell(): string {
  return process.env.SHELL?.trim() || "/bin/bash";
}

function isSafeCommandName(bin: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(bin);
}

function resolveLoginShellPath(): string | null {
  if (cachedLoginShellPath !== undefined) {
    return cachedLoginShellPath;
  }

  if (process.platform === "win32") {
    cachedLoginShellPath = null;
    return cachedLoginShellPath;
  }

  try {
    const shell = getLoginShell();
    const result = spawnSync(shell, ["-lc", "printf %s \"$PATH\""], {
      encoding: "utf8",
      timeout: 5000,
    });
    const resolved = result.status === 0 ? result.stdout.trim() : "";
    cachedLoginShellPath = resolved || null;
  } catch {
    cachedLoginShellPath = null;
  }

  return cachedLoginShellPath;
}

export function buildSpawnEnv(
  extraEnv?: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const loginShellPath = resolveLoginShellPath();
  return {
    ...process.env,
    ...(loginShellPath ? { PATH: loginShellPath } : {}),
    CLAUDECODE: undefined,
    ...extraEnv,
  };
}

export function runShellCheck(cmd: string, timeout = 10_000): boolean {
  try {
    const shell = getLoginShell();
    return spawnSync(shell, ["-lc", cmd], {
      encoding: "utf8",
      timeout,
    }).status === 0;
  } catch {
    return false;
  }
}

export function commandExists(bin: string): boolean {
  try {
    if (process.platform === "win32") {
      return spawnSync("where", [bin], {
        encoding: "utf8",
        timeout: 5000,
      }).status === 0;
    }

    if (!isSafeCommandName(bin)) {
      return false;
    }

    const shell = getLoginShell();
    return spawnSync(shell, ["-lc", `command -v ${bin} >/dev/null 2>&1`], {
      encoding: "utf8",
      timeout: 5000,
    }).status === 0;
  } catch {
    return false;
  }
}
