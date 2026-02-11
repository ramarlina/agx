/**
 * Local verification helpers for agx daemon runs.
 *
 * These are intentionally simple and conservative:
 * - Commands are selected from a small allowlist based on repo signals (package.json scripts).
 * - Commands run with timeouts and output truncation.
 * - Callers persist full outputs into local run artifacts; prompts should only include small summaries.
 */

const execa = require('execa');
const fs = require('fs');
const path = require('path');

function safeInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function truncate(text, maxChars) {
  const s = String(text || '');
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 20))}\n[truncated ${s.length - maxChars} chars]`;
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function detectVerifyCommands({ cwd } = {}) {
  const root = cwd || process.cwd();
  const pkg = readJsonFile(path.join(root, 'package.json'));
  const scripts = pkg && typeof pkg.scripts === 'object' ? pkg.scripts : {};

  /** @type {{ id: string, label: string, cmd: string, args: string[], cwd: string, timeout_ms: number }[]} */
  const commands = [];
  const timeoutMs = safeInt(process.env.AGX_VERIFY_CMD_TIMEOUT_MS, 5 * 60 * 1000);

  const addNpm = (id, label, npmArgs) => {
    commands.push({
      id,
      label,
      cmd: 'npm',
      args: npmArgs,
      cwd: root,
      timeout_ms: timeoutMs,
    });
  };

  // Keep this short and predictable; expensive suites should be scoped via package.json scripts.
  if (scripts.test) addNpm('npm_test', 'npm test', ['test']);
  if (scripts.lint) addNpm('npm_lint', 'npm run lint', ['run', 'lint']);
  if (scripts.typecheck) addNpm('npm_typecheck', 'npm run typecheck', ['run', 'typecheck']);

  // Cap to avoid runaway verification.
  const cap = safeInt(process.env.AGX_VERIFY_CMD_MAX, 3);
  return commands.slice(0, Math.max(0, cap));
}

function runLocalCommand({ cmd, args = [], cwd, timeout_ms, max_output_chars }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const maxChars = safeInt(max_output_chars, 20000);
    const timeoutMs = safeInt(timeout_ms, 5 * 60 * 1000);

    const child = execa(cmd, args, {
      cwd: cwd || process.cwd(),
      env: { ...process.env, TERM: 'dumb' },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      reject: false,
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const finish = (exitCode, error) => {
      if (finished) return;
      finished = true;
      const durationMs = Date.now() - startedAt;
      resolve({
        cmd,
        args,
        cwd: cwd || process.cwd(),
        exit_code: exitCode,
        duration_ms: durationMs,
        stdout: truncate(stdout, maxChars),
        stderr: truncate(stderr, maxChars),
        error: error ? String(error?.message || error) : null,
      });
    };

    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { }
      finish(-1, new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    timeout.unref?.();

    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timeout);
      finish(-1, err);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      finish(typeof code === 'number' ? code : -1, null);
    });
  });
}

async function runVerifyCommands(commands, options = {}) {
  const maxOutputChars = safeInt(options.max_output_chars, 20000);
  const results = [];
  for (const command of Array.isArray(commands) ? commands : []) {
    const res = await runLocalCommand({
      cmd: command.cmd,
      args: command.args || [],
      cwd: command.cwd || options.cwd || process.cwd(),
      timeout_ms: command.timeout_ms,
      max_output_chars: maxOutputChars,
    });
    results.push({
      id: command.id,
      label: command.label,
      ...res,
    });
  }
  return results;
}

function getGitSummary({ cwd } = {}) {
  const root = cwd || process.cwd();

  const run = (args) => {
    try {
      const res = execa.sync('git', args, { cwd: root, encoding: 'utf8', reject: false });
      return {
        code: typeof res.exitCode === 'number' ? res.exitCode : null,
        stdout: String(res.stdout || ''),
        stderr: String(res.stderr || ''),
      };
    } catch {
      return null;
    }
  };

  const inside = run(['rev-parse', '--is-inside-work-tree']);
  if (!inside || inside.code !== 0) {
    return { is_git: false, status_porcelain: '', diff_stat: '' };
  }

  const status = run(['status', '--porcelain=v1']);
  const diff = run(['diff', '--stat']);

  return {
    is_git: true,
    status_porcelain: status && status.code === 0 ? status.stdout : '',
    diff_stat: diff && diff.code === 0 ? diff.stdout : '',
  };
}

module.exports = {
  detectVerifyCommands,
  runVerifyCommands,
  getGitSummary,
};
