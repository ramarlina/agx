const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const DESKTOP_APP_BUNDLE_ID = 'com.agx.desktop';
const DESKTOP_APP_UPDATE_ARG = '--agx-update-now';

function getCliEntryPath() {
  try {
    return fs.realpathSync(path.resolve(__dirname, '..', '..', 'index.js'));
  } catch {
    return path.resolve(__dirname, '..', '..', 'index.js');
  }
}

function getBundledDesktopAppPath(cliEntryPath = getCliEntryPath()) {
  const normalized = path.resolve(cliEntryPath);
  const marker = `${path.sep}Contents${path.sep}Resources${path.sep}cli${path.sep}`;
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) return null;
  return normalized.slice(0, markerIndex);
}

function isBundledDesktopCli(cliEntryPath = getCliEntryPath()) {
  return Boolean(getBundledDesktopAppPath(cliEntryPath));
}

function findInstalledDesktopApp() {
  const bundledPath = getBundledDesktopAppPath();
  if (bundledPath && fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  const directCandidates = [
    '/Applications/agx.app',
    '/Applications/AGX.app',
    path.join(os.homedir(), 'Applications', 'agx.app'),
    path.join(os.homedir(), 'Applications', 'AGX.app'),
  ];

  for (const candidate of directCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  if (process.platform === 'darwin') {
    try {
      const matches = execFileSync('mdfind', [`kMDItemCFBundleIdentifier == "${DESKTOP_APP_BUNDLE_ID}"`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const firstApp = matches.find((match) => match.endsWith('.app'));
      if (firstApp && fs.existsSync(firstApp)) return firstApp;
    } catch {}
  }

  return null;
}

function launchDesktopAppUpdate(appPath) {
  if (!appPath) {
    return { launched: false, reason: 'not-installed' };
  }

  try {
    if (process.platform === 'darwin') {
      execFileSync('open', ['-a', appPath, '--args', DESKTOP_APP_UPDATE_ARG], {
        stdio: 'ignore',
      });
      return { launched: true, appPath };
    }

    return { launched: false, reason: `unsupported-platform:${process.platform}` };
  } catch (err) {
    return { launched: false, reason: err.message || 'launch-failed', appPath };
  }
}

function printDesktopUpdateResult({ c, result, bundledCli }) {
  if (result.launched) {
    console.log(`${c.green}✓${c.reset} Desktop app update started`);
    console.log(`  ${c.dim}${result.appPath}${c.reset}`);
    console.log(`  ${c.dim}The app will download and install any newer release.${c.reset}`);
    return;
  }

  if (result.reason === 'not-installed') {
    const detail = bundledCli
      ? 'Bundled desktop app path could not be resolved.'
      : 'Desktop app not found; skipping app update.';
    console.log(`${c.dim}${detail}${c.reset}`);
    return;
  }

  if (result.reason && result.reason.startsWith('unsupported-platform:')) {
    console.log(`${c.dim}Desktop app updates are only wired for macOS right now.${c.reset}`);
    return;
  }

  console.log(`${c.yellow}Warning:${c.reset} Failed to launch desktop app updater`);
  if (result.appPath) {
    console.log(`  ${c.dim}${result.appPath}${c.reset}`);
  }
  if (result.reason) {
    console.log(`  ${c.dim}${result.reason}${c.reset}`);
  }
}

async function maybeHandleUpdateCommand({ cmd, args, ctx }) {
  if (cmd !== 'update') return false;

  const { c, stopDaemon } = ctx;
  const subCmd = args[1];
  const bundledCli = isBundledDesktopCli();

  if (subCmd === 'status' || subCmd === '--status') {
    const pkg = require('../../package.json');
    const appPath = findInstalledDesktopApp();
    console.log(`${c.bold}agx update status${c.reset}\n`);
    console.log(`  CLI version: ${c.cyan}${pkg.version}${c.reset}`);
    console.log(`  CLI source: ${bundledCli ? `${c.green}desktop bundle${c.reset}` : `${c.cyan}npm/global${c.reset}`}`);
    console.log(`  Desktop app: ${appPath ? `${c.green}installed${c.reset}` : `${c.dim}not found${c.reset}`}`);
    if (appPath) {
      console.log(`  ${c.dim}${appPath}${c.reset}`);
    }
    process.exit(0);
  }

  console.log(`${c.cyan}Updating agx...${c.reset}\n`);

  if (subCmd === '--auto' || subCmd === 'auto' || subCmd === 'enable' || subCmd === '--off' || subCmd === 'off' || subCmd === 'disable') {
    console.log(`${c.yellow}Auto-update scheduling is no longer managed by agx.${c.reset}`);
    console.log(`  ${c.dim}Use your system scheduler to run \`agx update\` if you still want periodic updates.${c.reset}`);
    process.exit(0);
  }

  console.log(`${c.dim}Stopping daemon and board...${c.reset}`);
  try {
    await stopDaemon();
  } catch (err) {
    console.log(`${c.yellow}Warning:${c.reset} ${err.message}`);
  }

  console.log(`${c.dim}Killing processes on port 41741...${c.reset}`);
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      execSync("lsof -ti tcp:41741 | xargs kill -9 2>/dev/null || true", { stdio: 'ignore' });
    } else if (process.platform === 'win32') {
      execSync('for /f "tokens=5" %a in (\'netstat -aon ^| findstr :41741\') do taskkill /F /PID %a 2>nul', { stdio: 'ignore', shell: 'cmd.exe' });
    }
    console.log(`${c.green}✓${c.reset} Port 41741 cleared`);
  } catch {
    console.log(`${c.green}✓${c.reset} Port 41741 already free`);
  }

  if (bundledCli) {
    console.log(`\n${c.dim}CLI is running from agx.app, so updating the app will update the bundled CLI.${c.reset}`);
  } else {
    console.log(`\n${c.dim}Updating npm CLI package...${c.reset}`);
    try {
      execSync('npm install -g @mndrk/agx --force', { stdio: 'inherit' });
      console.log(`\n${c.green}✓${c.reset} CLI updated successfully`);
    } catch (err) {
      console.error(`\n${c.red}Failed to reinstall CLI:${c.reset} ${err.message}`);
      process.exit(1);
    }

    try {
      const version = execSync('agx --version', { encoding: 'utf8' }).trim();
      console.log(`${c.green}✓${c.reset} Now running ${c.cyan}${version}${c.reset}`);
    } catch {}
  }

  console.log(`\n${c.dim}Checking desktop app updates...${c.reset}`);
  const desktopResult = launchDesktopAppUpdate(findInstalledDesktopApp());
  printDesktopUpdateResult({ c, result: desktopResult, bundledCli });

  process.exit(0);
  return true;
}

module.exports = {
  DESKTOP_APP_BUNDLE_ID,
  DESKTOP_APP_UPDATE_ARG,
  getBundledDesktopAppPath,
  isBundledDesktopCli,
  findInstalledDesktopApp,
  launchDesktopAppUpdate,
  maybeHandleUpdateCommand,
};
