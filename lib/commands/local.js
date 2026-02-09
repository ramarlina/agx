async function maybeHandleLocalCommand({ cmd, args, isLocalMode, ctx }) {
  const { c } = ctx;

  // These commands use ~/.agx/projects/ filesystem storage.
  // Use --local flag or AGX_LOCAL=1 to force local mode.

  // agx local:new "<goal>" [--local]
  // Creates a new task in local storage
  if (cmd === 'local:new' || (cmd === 'new' && isLocalMode)) {
    const localCli = require('../local-cli');
    const jsonMode = args.includes('--json');

    // Extract goal text
    const flagsToRemove = ['--json', '--local', '--provider', '-P', '--model', '-m'];
    const goalParts = [];
    for (let i = 1; i < args.length; i++) {
      if (flagsToRemove.includes(args[i])) {
        if (['--provider', '-P', '--model', '-m'].includes(args[i])) i++;
        continue;
      }
      goalParts.push(args[i]);
    }
    const goalText = goalParts.join(' ');

    if (!goalText) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: 'missing_goal', usage: 'agx new "<goal>" --local' }));
      } else {
        console.log(`${c.red}Usage:${c.reset} agx new "<goal>" --local`);
      }
      process.exit(1);
    }

    try {
      await localCli.cmdNew({ userRequest: goalText, json: jsonMode });
    } catch (err) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: err.message }));
      } else {
        console.log(`${c.red}Error:${c.reset} ${err.message}`);
      }
      process.exit(1);
    }
    process.exit(0);
  }

  // agx local:tasks [--all] [--local]
  // List tasks from local storage
  if (cmd === 'local:tasks' || cmd === 'local:ls' || ((cmd === 'tasks' || cmd === 'ls') && isLocalMode)) {
    const localCli = require('../local-cli');
    const jsonMode = args.includes('--json');
    const showAll = args.includes('-a') || args.includes('--all');

    try {
      await localCli.cmdTasks({ all: showAll, json: jsonMode });
    } catch (err) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: err.message }));
      } else {
        console.log(`${c.red}Error:${c.reset} ${err.message}`);
      }
      process.exit(1);
    }
    process.exit(0);
  }

  // agx local:show <task> [--local]
  // Show task details from local storage
  if (cmd === 'local:show' || (cmd === 'show' && isLocalMode)) {
    const localCli = require('../local-cli');
    const jsonMode = args.includes('--json');
    const taskSlug = args.find((a, i) => i > 0 && !a.startsWith('-'));

    if (!taskSlug) {
      console.log(`${c.red}Usage:${c.reset} agx show <task> --local`);
      process.exit(1);
    }

    try {
      await localCli.cmdShow({ taskSlug, json: jsonMode });
    } catch (err) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: err.message }));
      } else {
        console.log(`${c.red}Error:${c.reset} ${err.message}`);
      }
      process.exit(1);
    }
    process.exit(0);
  }

  // agx local:runs <task> [--stage <stage>] [--local]
  // List runs for a task from local storage
  if (cmd === 'local:runs' || (cmd === 'runs' && isLocalMode)) {
    const localCli = require('../local-cli');
    const jsonMode = args.includes('--json');
    const taskSlug = args.find((a, i) => i > 0 && !a.startsWith('-'));

    let stage = null;
    const stageIdx = args.findIndex(a => a === '--stage' || a === '-s');
    if (stageIdx !== -1 && args[stageIdx + 1]) {
      stage = args[stageIdx + 1];
    }

    if (!taskSlug) {
      console.log(`${c.red}Usage:${c.reset} agx runs <task> [--stage <stage>] --local`);
      process.exit(1);
    }

    try {
      await localCli.cmdRuns({ taskSlug, stage, json: jsonMode });
    } catch (err) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: err.message }));
      } else {
        console.log(`${c.red}Error:${c.reset} ${err.message}`);
      }
      process.exit(1);
    }
    process.exit(0);
  }

  // agx local:complete <task> [--local]
  // Mark a task complete in local storage
  if (cmd === 'local:complete' || ((cmd === 'complete' || cmd === 'done') && isLocalMode)) {
    const localCli = require('../local-cli');
    const jsonMode = args.includes('--json');
    const taskSlug = args.find((a, i) => i > 0 && !a.startsWith('-'));

    if (!taskSlug) {
      console.log(`${c.red}Usage:${c.reset} agx complete <task> --local`);
      process.exit(1);
    }

    try {
      await localCli.cmdComplete({ taskSlug, json: jsonMode });
    } catch (err) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: err.message }));
      } else {
        console.log(`${c.red}Error:${c.reset} ${err.message}`);
      }
      process.exit(1);
    }
    process.exit(0);
  }

  // agx gc [--task <task>] [--keep <n>]
  // Run garbage collection on runs
  if (cmd === 'gc') {
    const localCli = require('../local-cli');
    const jsonMode = args.includes('--json');

    let taskSlug = null;
    const taskIdx = args.findIndex(a => a === '--task' || a === '-t');
    if (taskIdx !== -1 && args[taskIdx + 1]) {
      taskSlug = args[taskIdx + 1];
    }

    let keep = 25;
    const keepIdx = args.findIndex(a => a === '--keep' || a === '-k');
    if (keepIdx !== -1 && args[keepIdx + 1]) {
      keep = parseInt(args[keepIdx + 1], 10) || 25;
    }

    try {
      await localCli.cmdGc({ taskSlug, keep, json: jsonMode });
    } catch (err) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: err.message }));
      } else {
        console.log(`${c.red}Error:${c.reset} ${err.message}`);
      }
      process.exit(1);
    }
    process.exit(0);
  }

  // agx local:run <task> [--stage <stage>] [--local]
  // Prepare a run in local storage
  if (cmd === 'local:run' || (cmd === 'run' && isLocalMode)) {
    const localCli = require('../local-cli');
    const jsonMode = args.includes('--json');
    const taskSlug = args.find((a, i) => i > 0 && !a.startsWith('-'));

    let stage = 'execute';
    const stageIdx = args.findIndex(a => a === '--stage' || a === '-s');
    if (stageIdx !== -1 && args[stageIdx + 1]) {
      stage = args[stageIdx + 1];
    }

    let engine = 'claude';
    const engineIdx = args.findIndex(a => a === '--engine' || a === '-e');
    if (engineIdx !== -1 && args[engineIdx + 1]) {
      engine = args[engineIdx + 1];
    }

    if (!taskSlug) {
      console.log(`${c.red}Usage:${c.reset} agx run <task> [--stage <stage>] --local`);
      process.exit(1);
    }

    try {
      await localCli.cmdRun({ taskSlug, stage, engine, json: jsonMode });
    } catch (err) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: err.message }));
      } else {
        console.log(`${c.red}Error:${c.reset} ${err.message}`);
      }
      process.exit(1);
    }
    process.exit(0);
  }

  // agx unlock <task> [--local]
  // Force unlock a task
  if (cmd === 'unlock' || cmd === 'local:unlock') {
    const localCli = require('../local-cli');
    const jsonMode = args.includes('--json');
    const taskSlug = args.find((a, i) => i > 0 && !a.startsWith('-'));

    if (!taskSlug) {
      console.log(`${c.red}Usage:${c.reset} agx unlock <task>`);
      process.exit(1);
    }

    try {
      await localCli.cmdUnlock({ taskSlug, json: jsonMode });
    } catch (err) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: err.message }));
      } else {
        console.log(`${c.red}Error:${c.reset} ${err.message}`);
      }
      process.exit(1);
    }
    process.exit(0);
  }

  // agx tail <task> [--local]
  // Stream events for a task's latest run
  if (cmd === 'tail' || cmd === 'local:tail') {
    const localCli = require('../local-cli');
    const jsonMode = args.includes('--json');
    const taskSlug = args.find((a, i) => i > 0 && !a.startsWith('-'));

    if (!taskSlug) {
      console.log(`${c.red}Usage:${c.reset} agx tail <task>`);
      process.exit(1);
    }

    try {
      await localCli.cmdTail({ taskSlug, json: jsonMode });
    } catch (err) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: err.message }));
      } else {
        console.log(`${c.red}Error:${c.reset} ${err.message}`);
      }
      process.exit(1);
    }
    process.exit(0);
  }

  return false;
}

module.exports = { maybeHandleLocalCommand };

