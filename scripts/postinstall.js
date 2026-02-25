#!/usr/bin/env node
/**
 * Post-install script: enables auto-update by default
 * Users can opt out with: agx update --off
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

// Copy the platform-correct better-sqlite3 native addon into the standalone dir.
// npm already ran prebuild-install for the top-level dep, so we just copy that binary over.
try {
  const agxRoot = path.join(__dirname, '..');
  const boardModules = path.join(agxRoot, 'cloud-runtime', 'standalone');

  // Walk the standalone tree to find better-sqlite3 (cross-platform, no shell commands)
  function findDir(root, target) {
    if (!fs.existsSync(root)) return null;
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const full = path.join(dir, e.name);
        if (e.name === target && dir.includes('node_modules')) return full;
        stack.push(full);
      }
    }
    return null;
  }

  const standaloneSqliteDir = findDir(boardModules, 'better-sqlite3');

  // Find the agx-level better-sqlite3 (already built for this platform by npm)
  const agxSqliteNode = path.join(agxRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');

  if (standaloneSqliteDir && fs.existsSync(agxSqliteNode)) {
    const targetNode = path.join(standaloneSqliteDir, 'build', 'Release', 'better_sqlite3.node');
    fs.mkdirSync(path.dirname(targetNode), { recursive: true });
    fs.copyFileSync(agxSqliteNode, targetNode);
    console.log('  \x1b[32m✓\x1b[0m better-sqlite3 native addon installed for this platform');
  }
} catch (err) {
  console.log('  \x1b[33m⚠\x1b[0m Could not install better-sqlite3 native addon:', err.message || err);
}

// Only run on Unix-like systems (cron isn't available on Windows)
if (process.platform === 'win32') {
  process.exit(0);
}

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
