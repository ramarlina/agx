const { execSync } = require('child_process');

async function maybeHandleUpdateCommand({ cmd, args, ctx }) {
  if (cmd !== 'update') return false;

  const { c, stopDaemon } = ctx;

  console.log(`${c.cyan}Updating agx...${c.reset}\n`);

  // 1. Stop daemon (includes board)
  console.log(`${c.dim}Stopping daemon and board...${c.reset}`);
  try {
    await stopDaemon();
  } catch (err) {
    console.log(`${c.yellow}Warning:${c.reset} ${err.message}`);
  }

  // 2. Kill any processes on port 41741
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

  // 3. Reinstall without cache
  console.log(`\n${c.dim}Reinstalling @mndrk/agx...${c.reset}`);
  try {
    execSync('npm install -g @mndrk/agx --force', { stdio: 'inherit' });
    console.log(`\n${c.green}✓${c.reset} agx updated successfully`);
  } catch (err) {
    console.error(`\n${c.red}Failed to reinstall:${c.reset} ${err.message}`);
    process.exit(1);
  }

  // 4. Show new version
  try {
    const version = execSync('agx --version', { encoding: 'utf8' }).trim();
    console.log(`${c.green}✓${c.reset} Now running ${c.cyan}${version}${c.reset}`);
  } catch {}

  process.exit(0);
  return true;
}

module.exports = { maybeHandleUpdateCommand };
