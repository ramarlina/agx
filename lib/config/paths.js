const path = require('path');

const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';

// Config paths
const CONFIG_DIR = path.join(HOME_DIR, '.agx');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const CLOUD_CONFIG_FILE = path.join(CONFIG_DIR, 'cloud.json');

// Daemon/board paths (do not include __dirname-dependent paths here).
const DAEMON_PID_FILE = path.join(CONFIG_DIR, 'daemon.pid');
const DAEMON_LOG_FILE = path.join(CONFIG_DIR, 'daemon.log');
const DAEMON_STATE_FILE = path.join(CONFIG_DIR, 'daemon-state.json');
const TASK_LOGS_DIR = path.join(CONFIG_DIR, 'logs');

const BOARD_PID_FILE = path.join(CONFIG_DIR, 'board.pid');
const BOARD_LOG_FILE = path.join(CONFIG_DIR, 'board.log');
const BOARD_ENV_FILE = path.join(CONFIG_DIR, 'board.env');

module.exports = {
  HOME_DIR,
  CONFIG_DIR,
  CONFIG_FILE,
  CLOUD_CONFIG_FILE,
  DAEMON_PID_FILE,
  DAEMON_LOG_FILE,
  DAEMON_STATE_FILE,
  TASK_LOGS_DIR,
  BOARD_PID_FILE,
  BOARD_LOG_FILE,
  BOARD_ENV_FILE,
};

