// Programmatic entry point for @mndrk/agx.
// Keep this free of side effects; the CLI is available via require('@mndrk/agx/cli') or the `agx` binary.

const pkg = require('../package.json');
const { runCli } = require('../index.js');

module.exports = {
  version: pkg.version,
  runCli,
};

