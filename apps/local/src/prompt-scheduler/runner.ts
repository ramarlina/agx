import { spawn } from 'child_process';

export interface RunResult {
  status: 'success' | 'failed' | 'cancelled';
  output: string;
  error: string;
  durationMs: number;
}

export interface ExecuteRunOptions {
  provider: string;
  model: string;
  cliArgs: string;
  prompt: string;
  cancelCheckSec: number;
  isCancelled: () => Promise<boolean>;
  onStart: () => void;
  onComplete: (result: RunResult) => void;
}

interface CliCommand {
  cmd: string;
  args: string[];
}

const KNOWN_PROVIDERS: Record<string, { cmd: string; promptFlag: string; modelFlag?: string }> = {
  claude: { cmd: 'claude', promptFlag: '-p', modelFlag: '--model' },
  codex: { cmd: 'codex', promptFlag: '-p' },
  gemini: { cmd: 'gemini', promptFlag: '-p', modelFlag: '--model' },
};

export function buildCliCommand(provider: string, prompt: string, model?: string, cliArgs?: string): CliCommand {
  const known = KNOWN_PROVIDERS[provider];
  if (known) {
    const args: string[] = [];
    if (model && known.modelFlag) {
      args.push(known.modelFlag, model);
    }
    if (cliArgs) {
      args.push(...cliArgs.split(/\s+/).filter(Boolean));
    }
    args.push(known.promptFlag, prompt);
    return { cmd: known.cmd, args };
  }

  // Custom provider: treat as raw command
  const parts = provider.split(' ');
  const cmd = parts[0];
  const baseArgs = parts.slice(1);

  if (cliArgs) {
    baseArgs.push(...cliArgs.split(/\s+/).filter(Boolean));
  }

  if (provider.includes('{prompt}')) {
    const args = baseArgs.map((part) => part.replace('{prompt}', prompt));
    return { cmd, args };
  }

  return { cmd, args: [...baseArgs, prompt] };
}

export function executeRun(opts: ExecuteRunOptions): void {
  const { provider, model, cliArgs, prompt, cancelCheckSec, isCancelled, onStart, onComplete } = opts;

  const { cmd, args } = buildCliCommand(provider, prompt, model, cliArgs);
  const startMs = Date.now();

  onStart();

  let stdout = '';
  let stderr = '';
  let done = false;
  let cancelInterval: ReturnType<typeof setInterval> | null = null;

  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const finish = (result: RunResult) => {
    if (done) return;
    done = true;
    if (cancelInterval !== null) {
      clearInterval(cancelInterval);
      cancelInterval = null;
    }
    onComplete(result);
  };

  child.on('error', (err: Error) => {
    finish({
      status: 'failed',
      output: stdout,
      error: err.message,
      durationMs: Date.now() - startMs,
    });
  });

  child.on('close', (code: number | null) => {
    if (done) return;
    const status = code === 0 ? 'success' : 'failed';
    finish({
      status,
      output: stdout,
      error: stderr,
      durationMs: Date.now() - startMs,
    });
  });

  // Set up cancel checking interval
  const intervalMs = cancelCheckSec * 1000;
  cancelInterval = setInterval(async () => {
    if (done) {
      if (cancelInterval !== null) {
        clearInterval(cancelInterval);
        cancelInterval = null;
      }
      return;
    }
    try {
      const cancelled = await isCancelled();
      if (cancelled && !done) {
        child.kill('SIGTERM');
        finish({
          status: 'cancelled',
          output: stdout,
          error: stderr,
          durationMs: Date.now() - startMs,
        });
      }
    } catch {
      // ignore cancel check errors
    }
  }, intervalMs);
}
