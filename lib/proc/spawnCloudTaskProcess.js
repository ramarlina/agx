const { spawn } = require('child_process');
const { commandExists } = require('./commandExists');

function spawnCloudTaskProcess(childArgs, options = {}) {
  const useScriptTty = commandExists('script');
  const spawnCmd = useScriptTty ? 'script' : process.execPath;
  const spawnArgs = useScriptTty
    ? ['-q', '/dev/null', process.execPath, ...childArgs]
    : childArgs;
  return spawn(spawnCmd, spawnArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
}

module.exports = { spawnCloudTaskProcess };

