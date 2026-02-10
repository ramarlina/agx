const { spawn } = require('child_process');
const { commandExists } = require('./commandExists');
const { getProcessManager } = require('./ProcessManager');

function spawnCloudTaskProcess(childArgs, options = {}) {
  // A PTY wrapper (`script`) tends to inject control characters and can explode log churn
  // when stdout is streamed back into cloud task content. Only enable when explicitly requested.
  const useScriptTty = options.tty === true && commandExists('script');
  const spawnCmd = useScriptTty ? 'script' : process.execPath;
  const spawnArgs = useScriptTty
    ? ['-q', '/dev/null', process.execPath, ...childArgs]
    : childArgs;

  // Put spawned tasks in their own process group so we can reliably terminate the whole tree
  // (handles grandchild processes started by providers).
  const detachedDefault = process.platform !== 'win32';
  const env = {
    ...process.env,
    ...(options.env || {}),
    // Child can self-terminate if the parent crashes, preventing orphaned processes.
    AGX_PARENT_PID: String(process.pid),
  };

  const { timeoutMs, heartbeat, label, ...spawnOpts } = options;

  const child = spawn(spawnCmd, spawnArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: spawnOpts.detached ?? detachedDefault,
    env,
    ...spawnOpts
  });

  // Register with ProcessManager for tracking, heartbeat, and cleanup
  getProcessManager().register(child, {
    label: label || childArgs.join(' ').slice(0, 80),
    timeoutMs,
    heartbeat: heartbeat !== false,
  });

  return child;
}

module.exports = { spawnCloudTaskProcess };
