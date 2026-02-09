const { execSync } = require('child_process');

// Check if a command exists on PATH
function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

module.exports = { commandExists };

