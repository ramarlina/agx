const { spawn } = require('child_process');
const { commandExists } = require('./commandExists');

function spawnCloudTaskProcess(childArgs, options = {}) {
  const useScriptTty = commandExists('script');
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

  return spawn(spawnCmd, spawnArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: options.detached ?? detachedDefault,
    env,
    ...options
  });
}

module.exports = { spawnCloudTaskProcess };
