const fs = require('fs');
const { CLOUD_CONFIG_FILE } = require('./paths');

function loadCloudConfigFile(cloudConfigFile = CLOUD_CONFIG_FILE) {
  try {
    if (fs.existsSync(cloudConfigFile)) {
      return JSON.parse(fs.readFileSync(cloudConfigFile, 'utf8'));
    }
  } catch { }
  return null;
}

module.exports = { loadCloudConfigFile };

