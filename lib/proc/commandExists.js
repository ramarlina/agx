const execa = require('execa');

// Check if a command exists on PATH
function commandExists(cmd) {
  try {
    const tool = process.platform === 'win32' ? 'where' : 'which';
    const res = execa.sync(tool, [cmd], { stdio: 'ignore', reject: false });
    return res.exitCode === 0;
  } catch {
    return false;
  }
}

module.exports = { commandExists };
