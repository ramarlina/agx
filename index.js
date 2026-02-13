#!/usr/bin/env node
'use strict';

// Thin CLI entrypoint. The implementation lives in lib/cli/runCli.js.

(async () => {
  try {
    const { runCli } = require('./lib/cli/runCli');
    await runCli(process.argv);
  } catch (err) {
    const msg = err && err.stack ? err.stack : String(err);
    // Keep failures readable even if the implementation throws before it can render errors.
    process.stderr.write(`${msg}\n`);
    process.stderr.write(`\n💡 Run \x1b[36magx feedback\x1b[0m to report this issue\n`);
    process.exit(1);
  }
})();
