const execa = require('execa');

// Resolve a command to its absolute path, or return null
function resolveCommand(cmd) {
  try {
    const tool = process.platform === 'win32' ? 'where' : 'which';
    const res = execa.sync(tool, [cmd], { encoding: 'utf8', stderr: 'ignore', reject: false });
    if (res.exitCode === 0 && res.stdout) {
      return res.stdout.trim().split('\n')[0];
    }
  } catch { }
  return null;
}

// Check if a command exists on PATH
function commandExists(cmd) {
  return resolveCommand(cmd) !== null;
}

module.exports = { commandExists, resolveCommand };
