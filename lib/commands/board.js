'use strict';

const execa = require('execa');
const { c } = require('../ui/colors');
const { isBoardRunning, ensureBoardRunning, getBoardPort, loadBoardEnv, saveBoardEnvValue } = require('../cli/daemon');
const { commandExists } = require('../proc/commandExists');

// Check if tailscale CLI is available
async function checkTailscale() {
  if (!await commandExists('tailscale')) {
    console.log(`${c.red}✗${c.reset} Tailscale CLI not found`);
    console.log(`  ${c.dim}Install Tailscale: https://tailscale.com/kb/1069/install-macos/${c.reset}`);
    console.log(`  ${c.dim}Then run: ${c.cyan}tailscale login${c.reset}`);
    return false;
  }
  return true;
}

// Get Tailscale DNS name for this machine
async function getTailscaleFqdn() {
  try {
    const { stdout } = await execa('tailscale', ['status', '--json']);
    const status = JSON.parse(stdout);
    const dns = status.Self?.DNSName;
    if (dns) return dns.replace(/\.$/, ''); // strip trailing dot
    return null;
  } catch {
    return null;
  }
}

// Check if a local port is being served via tailscale serve
async function isTailscaleServed(port) {
  try {
    const { stdout } = await execa('tailscale', ['serve', 'status', '--json']);
    const status = JSON.parse(stdout);
    if (!status.Web) return false;
    const portStr = String(port);
    for (const host of Object.values(status.Web)) {
      for (const handler of Object.values(host.Handlers || {})) {
        if (handler.Proxy && handler.Proxy.endsWith(':' + portStr)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Handle `agx board share` subcommand.
 * Called from daemonBoard.js when subcmd === 'share'.
 */
async function handleBoardShare({ args, ctx }) {
  const { getBoardPort: ctxGetBoardPort } = ctx;
  if (!(await checkTailscale())) {
    process.exit(1);
  }

  const isOff = args.includes('--off');
  const isStatus = args.includes('--status');
  const port = ctxGetBoardPort ? ctxGetBoardPort() : getBoardPort();

  // ── share --status ─────────────────────────────────────────────
  if (isStatus) {
    const isServed = await isTailscaleServed(port);
    const boardEnv = loadBoardEnv();
    const configuredUrl = boardEnv.AGX_BOARD_URL;

    console.log(`${c.bold}Board Remote Access Status${c.reset}\n`);
    console.log(`  ${c.dim}Port:${c.reset}        ${port}`);
    console.log(`  ${c.dim}Tailscale:${c.reset}  ${isServed ? c.green + 'serving' + c.reset : c.dim + 'not serving' + c.reset}`);
    console.log(`  ${c.dim}Config URL:${c.reset} ${configuredUrl || c.dim + '(none)' + c.reset}`);

    if (configuredUrl && isServed) {
      console.log(`\n  ${c.green}✓${c.reset} Access your board at: ${c.cyan}${configuredUrl}${c.reset}`);
    } else if (configuredUrl) {
      console.log(`\n  ${c.yellow}⚠${c.reset} URL configured but Tailscale Serve not active`);
      console.log(`  ${c.dim}Run ${c.cyan}agx board share${c.reset} to enable`);
    } else {
      console.log(`\n  ${c.dim}Run ${c.cyan}agx board share${c.reset} to enable remote access`);
    }

    process.exit(0);
  }

  // ── share --off ────────────────────────────────────────────────
  if (isOff) {
    console.log(`${c.dim}Disabling Tailscale Serve for board...${c.reset}`);

    try {
      // Reset all tailscale serve config (no per-handler removal in the CLI)
      await execa('tailscale', ['serve', 'reset']);
      // Clear the AGX_BOARD_URL if it points to a tailscale URL
      const boardEnv = loadBoardEnv();
      if (boardEnv.AGX_BOARD_URL?.includes('.ts.net')) {
        saveBoardEnvValue('AGX_BOARD_URL', '');
      }
      console.log(`${c.green}✓${c.reset} Tailscale Serve disabled`);
      console.log(`  ${c.dim}Board is still accessible at http://localhost:${port}${c.reset}`);
    } catch (err) {
      console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
      process.exit(1);
    }

    process.exit(0);
  }

  // ── share (enable) ─────────────────────────────────────────────
  console.log(`${c.dim}Enabling Tailscale Serve for board...${c.reset}`);

  try {
    // Get Tailscale FQDN
    const fqdn = await getTailscaleFqdn();
    if (!fqdn) {
      console.log(`${c.red}✗${c.reset} Could not get Tailscale hostname`);
      console.log(`  ${c.dim}Make sure you're logged in: ${c.cyan}tailscale status${c.reset}`);
      process.exit(1);
    }

    // Ensure board is running and verify it's healthy
    await ensureBoardRunning();
    const pid = isBoardRunning();
    if (!pid) {
      console.log(`${c.red}✗${c.reset} Board server failed to start`);
      console.log(`  ${c.dim}Check logs with: ${c.cyan}agx board logs${c.reset}`);
      process.exit(1);
    }

    // Start tailscale serve (proxies HTTPS to local port)
    await execa('tailscale', ['serve', '--bg', String(port)]);

    // Save the board URL
    const boardUrl = `https://${fqdn}`;
    saveBoardEnvValue('AGX_BOARD_URL', boardUrl);

    console.log(`${c.green}✓${c.reset} Board is now accessible remotely`);
    console.log(`\n  ${c.bold}URL:${c.reset} ${c.cyan}${boardUrl}${c.reset}`);
    console.log(`\n${c.dim}Access from your phone or tablet by:${c.reset}`);
    console.log(`  ${c.dim}1. Make sure your device is on the same Tailnet${c.reset}`);
    console.log(`  ${c.dim}2. Open: ${boardUrl}${c.reset}`);
    console.log(`\n${c.dim}To stop sharing:${c.reset} ${c.cyan}agx board share --off${c.reset}`);
  } catch (err) {
    console.log(`${c.red}✗${c.reset} Failed: ${err.message}`);
    if (err.stderr) {
      console.log(`  ${c.dim}${err.stderr.trim()}${c.reset}`);
    }
    console.log(`\n${c.dim}You may need admin/sudo privileges for 'tailscale serve'${c.reset}`);
    process.exit(1);
  }

  process.exit(0);
}

module.exports = { handleBoardShare, isTailscaleServed };
