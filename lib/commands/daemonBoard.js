const fs = require('fs');
const execa = require('execa');

function getBoardUrl({ getBoardPort }) {
  const apiUrl = process.env.AGX_CLOUD_URL || process.env.AGX_BOARD_URL || 'http://localhost:41741';
  try {
    const u = new URL(apiUrl);
    if (!u.port) u.port = String(u.protocol === 'https:' ? 443 : 80);
    return u.toString().replace(/\/+$/, '');
  } catch {
    return `http://localhost:${getBoardPort()}`;
  }
}

function shouldAutoOpenBoard() {
  const noOpen = String(process.env.AGX_NO_OPEN || process.env.AGX_BOARD_NO_OPEN || '').toLowerCase();
  if (noOpen === '1' || noOpen === 'true' || noOpen === 'yes') return false;
  if (process.env.CI) return false;
  return Boolean(process.stdout && process.stdout.isTTY);
}

function openInBrowser(url) {
  try {
    if (!url) return false;
    if (process.platform === 'darwin') {
      const p = execa('open', [url], { stdio: 'ignore', detached: true, reject: false });
      p.unref?.();
      return true;
    }
    if (process.platform === 'win32') {
      const p = execa('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true, reject: false });
      p.unref?.();
      return true;
    }
    const p = execa('xdg-open', [url], { stdio: 'ignore', detached: true, reject: false });
    p.unref?.();
    return true;
  } catch {
    return false;
  }
}

async function maybeHandleDaemonBoardCommand({ cmd, args, ctx }) {
  const {
    c,
    loadCloudConfig,
    cloudRequest,
    runCloudDaemonLoop,
    startDaemon,
    stopDaemon,
    isDaemonRunning,
    DAEMON_LOG_FILE,
    isBoardRunning,
    BOARD_LOG_FILE,
    ensureBoardRunning,
    stopBoard,
    probeBoardHealth,
    getBoardPort,
    setBoardEnsuredFalse,
  } = ctx;

  // Daemon commands
  if (cmd === 'daemon') {
    const daemonArgs = args.slice(1);
    const subcmd = daemonArgs[0] && !daemonArgs[0].startsWith('-') ? daemonArgs[0] : undefined;
    const wantsHelp = args.includes('--help') || args.includes('-h') || subcmd === 'help';
    const wantsDryPick = args.includes('--dry-pick');
    const workersFlagIdx = args.findIndex((arg) => arg === '-w' || arg === '--workers' || arg === '--max-workers');
    let maxWorkers;
    if (workersFlagIdx !== -1) {
      const raw = args[workersFlagIdx + 1];
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        console.log(`${c.red}Invalid worker count:${c.reset} ${raw || '(missing)'}`);
        console.log(`${c.dim}Use a positive integer, e.g. -w 4${c.reset}`);
        process.exit(1);
      }
      maxWorkers = parsed;
    }

    const wantsTail = args.includes('-t') || args.includes('--tail');

    const daemonOptions = {
      maxWorkers,
    };

    if (wantsHelp) {
      console.log(`${c.bold}agx daemon${c.reset} - Local cloud worker\n`);
      console.log(`  agx daemon            Run local daemon loop in foreground`);
      console.log(`  agx daemon start      Start local daemon loop in background`);
      console.log(`  agx daemon restart    Stop + start daemon`);
      console.log(`  agx daemon stop       Stop background worker`);
      console.log(`  agx daemon status     Check if running`);
      console.log(`  agx daemon logs       Show recent logs`);
      console.log(`  agx daemon tail       Live tail daemon logs`);
      console.log(`  agx daemon pick       Preview next task candidate (no claim)`);
      console.log(`  agx daemon --dry-pick Preview next task candidate (no claim)`);
      console.log(`  agx daemon -w, --workers <n>  Execution worker count (default: 1)`);
      console.log(`  agx daemon start -t   Start and tail logs`);
      console.log(`  agx daemon restart -t Restart and tail logs`);
      process.exit(0);
    }

    if (subcmd === 'pick' || wantsDryPick) {
      const cloudConfig = loadCloudConfig();
      if (!cloudConfig?.apiUrl) {
        console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
        process.exit(1);
      }
      if (typeof cloudRequest !== 'function') {
        console.log(`${c.red}Cloud client unavailable for dry pick.${c.reset}`);
        process.exit(1);
      }

      const toPriorityRank = (task) => {
        const raw = task?.priority;
        const n = Number(raw);
        return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
      };

      const toCreatedMs = (task) => {
        const ms = Date.parse(String(task?.created_at || ''));
        return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
      };

      const formatTaskLabel = (task) => task?.title || task?.slug || task?.id || 'Untitled';
      const toDependencySummary = (deps = []) => {
        const unresolved = deps.filter((dep) => String(dep?.status || '') !== 'completed');
        if (!unresolved.length) return null;
        const shown = unresolved.slice(0, 3).map((dep) => {
          const label = dep?.title || dep?.slug || dep?.id || '(unknown)';
          const suffix = dep?.status ? ` (${dep.status})` : '';
          return `${label}${suffix}`;
        });
        const extra = unresolved.length > 3 ? ` +${unresolved.length - 3} more` : '';
        return `Waiting on dependencies: ${shown.join(', ')}${extra}`;
      };

      let queuedTasks = [];
      try {
        const response = await cloudRequest('GET', '/api/tasks?status=queued');
        queuedTasks = Array.isArray(response?.tasks) ? response.tasks : [];
      } catch (err) {
        console.log(`${c.red}Failed to fetch queued tasks:${c.reset} ${err?.message || err}`);
        process.exit(1);
      }

      const candidates = queuedTasks
        .filter((task) => String(task?.stage || '').toLowerCase() !== 'done')
        .sort((a, b) => {
          const prio = toPriorityRank(a) - toPriorityRank(b);
          if (prio !== 0) return prio;
          return toCreatedMs(a) - toCreatedMs(b);
        })
        .slice(0, 25);

      if (!candidates.length) {
        console.log(`${c.dim}No queued tasks available for pickup.${c.reset}`);
        process.exit(0);
      }

      let selected = null;
      const skipped = [];
      for (const candidate of candidates) {
        let dependsOnTasks = [];
        try {
          const depResponse = await cloudRequest('GET', `/api/tasks/${encodeURIComponent(candidate.id)}/dependencies`);
          dependsOnTasks = Array.isArray(depResponse?.depends_on_tasks) ? depResponse.depends_on_tasks : [];
        } catch {
          dependsOnTasks = [];
        }

        const blockedReason = toDependencySummary(dependsOnTasks);
        if (blockedReason) {
          skipped.push({ task: candidate, reason: blockedReason });
          continue;
        }
        selected = candidate;
        break;
      }

      if (!selected) {
        console.log(`${c.yellow}No runnable queued tasks right now.${c.reset}`);
        if (skipped.length) {
          const first = skipped[0];
          console.log(`${c.dim}Top blocked candidate:${c.reset} ${formatTaskLabel(first.task)} (${first.task.id})`);
          console.log(`${c.dim}${first.reason}${c.reset}`);
        }
        process.exit(0);
      }

      console.log(`${c.green}Next daemon pick (dry):${c.reset} ${formatTaskLabel(selected)}`);
      console.log(`  ID: ${selected.id}`);
      console.log(`  Stage: ${selected.stage || 'unknown'}`);
      console.log(`  Status: ${selected.status || 'queued'}`);
      console.log(`  Priority: ${selected.priority ?? 'none'}`);
      console.log(`  Created: ${selected.created_at || 'unknown'}`);
      if (skipped.length) {
        console.log(`${c.dim}Skipped ${skipped.length} blocked queued task(s) before this candidate.${c.reset}`);
      }
      process.exit(0);
    }

    if (!subcmd || subcmd === 'run' || subcmd === '--run') {
      const cloudConfig = loadCloudConfig();
      if (!cloudConfig?.apiUrl) {
        console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
        process.exit(1);
      }

      await runCloudDaemonLoop(daemonOptions);
      return true;
    }

    if (subcmd === 'start') {
      startDaemon(daemonOptions);
      if (wantsTail) {
        // Give daemon a moment to create log file
        await new Promise(r => setTimeout(r, 500));
        if (fs.existsSync(DAEMON_LOG_FILE)) {
          console.log(`${c.dim}Tailing ${DAEMON_LOG_FILE}... (Ctrl+C to stop)${c.reset}\n`);
          const tail = execa('tail', ['-f', DAEMON_LOG_FILE], { stdio: 'inherit', reject: false });
          tail.on('close', () => process.exit(0));
          return true;
        }
      }
      process.exit(0);
    } else if (subcmd === 'restart') {
      await stopDaemon();
      startDaemon(daemonOptions);
      if (wantsTail) {
        await new Promise(r => setTimeout(r, 500));
        if (fs.existsSync(DAEMON_LOG_FILE)) {
          console.log(`${c.dim}Tailing ${DAEMON_LOG_FILE}... (Ctrl+C to stop)${c.reset}\n`);
          const tail = execa('tail', ['-f', DAEMON_LOG_FILE], { stdio: 'inherit', reject: false });
          tail.on('close', () => process.exit(0));
          return true;
        }
      }
      process.exit(0);
    } else if (subcmd === 'stop') {
      await stopDaemon();
      process.exit(0);
    } else if (subcmd === 'status') {
      const pid = isDaemonRunning();
      if (pid) {
        console.log(`${c.green}Daemon running${c.reset} (pid ${pid})`);
        console.log(`${c.dim}Logs: ${DAEMON_LOG_FILE}${c.reset}`);
      } else {
        console.log(`${c.yellow}Daemon not running${c.reset}`);
      }
      const boardPid = isBoardRunning();
      if (boardPid) {
        console.log(`${c.green}Board server running${c.reset} (pid ${boardPid})`);
        console.log(`${c.dim}Logs: ${BOARD_LOG_FILE}${c.reset}`);
      } else {
        console.log(`${c.yellow}Board server not running${c.reset}`);
      }
      process.exit(0);
    } else if (subcmd === 'logs') {
      if (fs.existsSync(DAEMON_LOG_FILE)) {
        const logs = fs.readFileSync(DAEMON_LOG_FILE, 'utf8');
        console.log(logs.split('\n').slice(-50).join('\n'));
      } else {
        console.log(`${c.dim}No logs yet${c.reset}`);
      }
      process.exit(0);
    } else if (subcmd === 'tail') {
      if (!fs.existsSync(DAEMON_LOG_FILE)) {
        console.log(`${c.dim}No logs yet. Start daemon with: agx daemon start${c.reset}`);
        process.exit(0);
      }
      console.log(`${c.dim}Tailing ${DAEMON_LOG_FILE}... (Ctrl+C to stop)${c.reset}\n`);
      const tail = execa('tail', ['-f', DAEMON_LOG_FILE], { stdio: 'inherit', reject: false });
      tail.on('close', () => process.exit(0));
      return true;
    } else {
      console.log(`${c.red}Unknown daemon command:${c.reset} ${subcmd}`);
      console.log(`${c.dim}Run: agx daemon --help${c.reset}`);
      process.exit(0);
    }
    return true;
  }

  // Board commands
  if (cmd === 'board') {
    const subcmd = args[1];
    const wantsHelp = args.includes('--help') || args.includes('-h') || subcmd === 'help';
    const noOpen = args.includes('--no-open') || args.includes('--no-browser');
    if (!subcmd || subcmd === 'start') {
      if (typeof setBoardEnsuredFalse === 'function') setBoardEnsuredFalse();
      await ensureBoardRunning();
      if (!noOpen && shouldAutoOpenBoard()) {
        const port = getBoardPort();
        const healthy = await probeBoardHealth(port);
        if (healthy) openInBrowser(getBoardUrl({ getBoardPort }));
      }
      process.exit(0);
    } else if (subcmd === 'stop') {
      await stopBoard();
      process.exit(0);
    } else if (wantsHelp) {
      console.log(`${c.bold}agx board${c.reset} - Local board runtime\n`);
      console.log(`  agx board start        Start local board server`);
      console.log(`  agx board stop         Stop local board server`);
      console.log(`  agx board status       Show status`);
      console.log(`  agx board show         Print URL/log paths`);
      console.log(`  agx board open         Open board in browser`);
      console.log(`  agx board logs         Show recent logs`);
      console.log(`  agx board tail         Live tail logs`);
      console.log(`  agx board start --no-open   Do not open browser`);
      console.log(`  Env: AGX_NO_OPEN=1 (or AGX_BOARD_NO_OPEN=1)`);
      process.exit(0);
    } else if (subcmd === 'status') {
      const pid = isBoardRunning();
      if (pid) {
        const port = getBoardPort();
        const healthy = await probeBoardHealth(port);
        console.log(`${c.green}Board server running${c.reset} (pid ${pid}, port ${port}${healthy ? ', healthy' : ', not responding'})`);
        console.log(`${c.dim}Logs: ${BOARD_LOG_FILE}${c.reset}`);
      } else {
        console.log(`${c.yellow}Board server not running${c.reset}`);
      }
      process.exit(0);
    } else if (subcmd === 'show') {
      const url = getBoardUrl({ getBoardPort });
      const pid = isBoardRunning();
      console.log(`${c.bold}Board${c.reset}`);
      console.log(`  URL:  ${url}`);
      console.log(`  Logs: ${BOARD_LOG_FILE}`);
      if (pid) console.log(`  PID:  ${pid}`);
      process.exit(0);
    } else if (subcmd === 'open') {
      if (typeof setBoardEnsuredFalse === 'function') setBoardEnsuredFalse();
      await ensureBoardRunning();
      const url = getBoardUrl({ getBoardPort });
      console.log(`${c.dim}Opening:${c.reset} ${url}`);
      if (!noOpen) openInBrowser(url);
      process.exit(0);
    } else if (subcmd === 'logs') {
      if (fs.existsSync(BOARD_LOG_FILE)) {
        const logs = fs.readFileSync(BOARD_LOG_FILE, 'utf8');
        console.log(logs.split('\n').slice(-50).join('\n'));
      } else {
        console.log(`${c.dim}No board logs yet${c.reset}`);
      }
      process.exit(0);
    } else if (subcmd === 'tail') {
      if (!fs.existsSync(BOARD_LOG_FILE)) {
        console.log(`${c.dim}No board logs yet. Start with: agx board start${c.reset}`);
        process.exit(0);
      }
      console.log(`${c.dim}Tailing ${BOARD_LOG_FILE}... (Ctrl+C to stop)${c.reset}\n`);
      const tail = execa('tail', ['-f', BOARD_LOG_FILE], { stdio: 'inherit', reject: false });
      tail.on('close', () => process.exit(0));
      return true;
    } else {
      console.log(`${c.red}Unknown board command:${c.reset} ${subcmd}`);
      console.log(`${c.dim}Usage: agx board [start|stop|status|show|open|logs|tail]${c.reset}`);
      process.exit(0);
    }
    return true;
  }

  return false;
}

module.exports = { maybeHandleDaemonBoardCommand };
