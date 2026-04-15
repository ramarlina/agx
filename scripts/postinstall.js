#!/usr/bin/env node
/**
 * Post-install script:
 *   1. Rebuilds node-pty from source on Linux (no prebuild is bundled for Linux).
 *   2. Enables auto-update via cron (daily at 3am).
 */

const execa = require('execa');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CRON_MARKER = '# agx-auto-update';
const CRON_SCHEDULE = '0 3 * * *';
const CRON_CMD = 'npm update -g @mndrk/agx';

// Skip in CI or non-interactive environments
if (process.env.CI || process.env.AGX_SKIP_POSTINSTALL) {
  process.exit(0);
}

// Only run on Unix-like systems (cron isn't available on Windows)
if (process.platform === 'win32') {
  process.exit(0);
}

// ─── Linux: rebuild node-pty from source ────────────────────────────────────
// AGX ships prebuilds for macOS and Windows only. On Linux, compile the native
// module against the current Node.js ABI so the full PTY experience works.
// This is a no-op after the first successful build (or after a Node upgrade
// that changes the ABI). On failure the terminal falls back to compat mode.
if (process.platform === 'linux') {
  try {
    rebuildNodePtyIfNeeded();
  } catch {
    // Non-fatal: terminal will fall back to compatibility mode automatically.
  }
}

// ─── Auto-update via cron ───────────────────────────────────────────────────
try {
  // Check if already enabled
  const crontab = execa.commandSync('crontab -l 2>/dev/null || true', {
    shell: true,
    encoding: 'utf8',
    reject: false,
  }).stdout || '';
  if (crontab.includes(CRON_MARKER)) {
    // Already enabled, skip
    process.exit(0);
  }

  // Enable auto-update
  const newLine = `${CRON_SCHEDULE} ${CRON_CMD} ${CRON_MARKER}\n`;
  const tmp = path.join(os.tmpdir(), `agx-crontab-${Date.now()}`);
  fs.writeFileSync(tmp, crontab + newLine);
  execa.commandSync(`crontab ${tmp}`, { shell: true, stdio: 'pipe', reject: false });
  fs.unlinkSync(tmp);

  console.log('\n  \x1b[32m✓\x1b[0m Auto-update enabled (daily at 3am)');
  console.log('    To disable: \x1b[36magx update --off\x1b[0m');
  console.log('\n  \x1b[2magx collects anonymous usage data to improve the tool.\x1b[0m');
  console.log('    To disable: \x1b[36magx telemetry off\x1b[0m\n');
} catch (err) {
  // Silently fail - don't break install if cron setup fails
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compile node-pty for the current Linux platform/arch/ABI if no compatible
 * prebuild is already present. Idempotent: a marker file records the ABI so
 * subsequent installs of the same Node version are instant.
 */
function rebuildNodePtyIfNeeded() {
  const { execSync } = require('child_process');

  const ptyDir = path.join(
    __dirname, '..', 'cloud-runtime', 'standalone', 'node_modules', 'node-pty',
  );
  if (!fs.existsSync(ptyDir)) return; // dev env / cloud-runtime not packed yet

  const abi = process.versions.modules;
  const prebuildDir = path.join(ptyDir, 'prebuilds', `linux-${process.arch}`);
  const ptyBinary = path.join(prebuildDir, 'pty.node');
  const abiMarker = path.join(prebuildDir, `.abi-${abi}`);

  // Already built for this Node ABI — nothing to do.
  if (fs.existsSync(ptyBinary) && fs.existsSync(abiMarker)) return;

  const ptyVersion = JSON.parse(
    fs.readFileSync(path.join(ptyDir, 'package.json'), 'utf8'),
  ).version;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agx-pty-'));
  try {
    process.stdout.write(`\n  Building node-pty@${ptyVersion} for Linux (one-time setup)...`);

    // Install source only — skip scripts so we don't trigger a (failing) prebuild download.
    execSync(`npm install --ignore-scripts node-pty@${ptyVersion}`, {
      cwd: tmpDir,
      stdio: 'pipe',
    });

    // Compile the native addon using npm's bundled node-gyp when available,
    // otherwise fall back to whatever `node-gyp` is on PATH.
    const nodeGyp = findNodeGyp(execSync);
    const gypCmd = nodeGyp
      ? `"${process.execPath}" "${nodeGyp}" rebuild`
      : 'node-gyp rebuild';

    execSync(gypCmd, {
      cwd: path.join(tmpDir, 'node_modules', 'node-pty'),
      stdio: 'pipe',
    });

    // Place the binary where AGX's module loader expects it.
    fs.mkdirSync(prebuildDir, { recursive: true });
    fs.copyFileSync(
      path.join(tmpDir, 'node_modules', 'node-pty', 'build', 'Release', 'pty.node'),
      ptyBinary,
    );
    // Write ABI marker so we skip the build on the next install.
    fs.writeFileSync(abiMarker, String(abi));

    console.log(' \x1b[32m✓\x1b[0m');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Return the path to node-gyp bundled with the active npm, or null if not found.
 * npm ships its own node-gyp, so this works without a separate `npm i -g node-gyp`.
 */
function findNodeGyp(execSync) {
  try {
    const npmRoot = execSync('npm root -g', { encoding: 'utf8', stdio: 'pipe' }).trim();
    const candidate = path.join(npmRoot, 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
    if (fs.existsSync(candidate)) return candidate;
  } catch {}
  return null;
}
