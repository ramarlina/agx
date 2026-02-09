const fs = require('fs');
const { spawn } = require('child_process');

async function maybeHandleDaemonBoardCommand({ cmd, args, ctx }) {
  const {
    c,
    loadCloudConfig,
    runCloudDaemonLoop,
    startDaemon,
    stopDaemon,
    isDaemonRunning,
    ensureTemporalWorkerRunning,
    stopTemporalWorker,
    isTemporalWorkerRunning,
    WORKER_LOG_FILE,
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

    const daemonOptions = {
      maxWorkers,
    };

    if (wantsHelp) {
      console.log(`${c.bold}agx daemon${c.reset} - Local cloud worker\n`);
      console.log(`  agx daemon            Run local daemon loop in foreground`);
      console.log(`  agx daemon start      Start local daemon loop in background`);
      console.log(`  agx daemon stop       Stop background worker`);
      console.log(`  agx daemon status     Check if running`);
      console.log(`  agx daemon logs       Show recent logs`);
      console.log(`  agx daemon tail       Live tail daemon logs`);
      console.log(`  agx daemon -w, --workers <n>  Execution worker count (default: 1)`);
      process.exit(0);
    }

    if (!subcmd || subcmd === 'run' || subcmd === '--run') {
      const cloudConfig = loadCloudConfig();
      if (!cloudConfig?.apiUrl) {
        console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
        process.exit(1);
      }

      // Ensure the pg-boss orchestrator worker is running; otherwise stage completion signals
      // won't be processed and tasks can get stuck in in_progress.
      if (typeof ensureTemporalWorkerRunning === 'function') {
        await ensureTemporalWorkerRunning();
      }

      await runCloudDaemonLoop(daemonOptions);
      return true;
    }

    if (subcmd === 'start') {
      startDaemon(daemonOptions);
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
      const temporalPid = typeof isTemporalWorkerRunning === 'function' ? isTemporalWorkerRunning() : null;
      if (temporalPid) {
        console.log(`${c.green}Orchestrator worker running${c.reset} (pid ${temporalPid})`);
        console.log(`${c.dim}Logs: ${WORKER_LOG_FILE}${c.reset}`);
      } else {
        console.log(`${c.yellow}Orchestrator worker not running${c.reset}`);
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
      const tail = spawn('tail', ['-f', DAEMON_LOG_FILE], { stdio: 'inherit' });
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
    if (!subcmd || subcmd === 'start') {
      if (typeof setBoardEnsuredFalse === 'function') setBoardEnsuredFalse();
      await ensureBoardRunning();
      // `agx run` intentionally does not autostart the orchestrator worker, but
      // `agx board start` is an explicit local-runtime action, so we also start
      // the worker to ensure /api/queue/complete stage transitions are applied.
      if (typeof ensureTemporalWorkerRunning === 'function') {
        void ensureTemporalWorkerRunning();
      }
      process.exit(0);
    } else if (subcmd === 'stop') {
      await stopBoard();
      // Best-effort: stop the worker when stopping the local board runtime.
      if (typeof stopTemporalWorker === 'function') {
        await stopTemporalWorker();
      }
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
      const tail = spawn('tail', ['-f', BOARD_LOG_FILE], { stdio: 'inherit' });
      tail.on('close', () => process.exit(0));
      return true;
    } else {
      console.log(`${c.red}Unknown board command:${c.reset} ${subcmd}`);
      console.log(`${c.dim}Usage: agx board [start|stop|status|logs|tail]${c.reset}`);
      process.exit(0);
    }
    return true;
  }

  return false;
}

module.exports = { maybeHandleDaemonBoardCommand };
