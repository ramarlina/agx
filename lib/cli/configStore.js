/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const readline = require('readline');
const { CONFIG_DIR, CONFIG_FILE } = require('../config/paths');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch { }
  return null;
}

function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer = '') => {
      if (settled) return;
      settled = true;
      try { rl.close(); } catch { }
      resolve(answer);
    };

    rl.question(question, (answer) => {
      finish(answer);
    });

    // In non-interactive shells stdin can close without invoking question callback.
    rl.on('close', () => finish(''));
    rl.on('SIGINT', () => finish(''));
  });
}

module.exports = { loadConfig, saveConfig, prompt };
