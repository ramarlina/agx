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
