async function maybeHandleThreadCommand({ cmd, args, ctx }) {
  if (cmd !== 'thread') return false;
  const { c, cloudRequest } = ctx;

  const subcommand = (args[1] || '').toLowerCase();

  if (subcommand !== 'status' || args.includes('--help') || args.includes('-h')) {
    console.log(`agx thread - Manage chat threads

USAGE:
  agx thread status <messageId> <status>    Set thread status

STATUSES:
  thinking, converged, resolved, in-review, archived`);
    process.exit(subcommand === 'status' ? 1 : 0);
  }

  const messageId = args[2];
  const status = args[3];

  if (!messageId || !status) {
    console.log(`${c.red}✗${c.reset} Usage: agx thread status <messageId> <status>`);
    process.exit(1);
  }

  const valid = ['thinking', 'converged', 'resolved', 'in-review', 'archived'];
  if (!valid.includes(status)) {
    console.log(`${c.red}✗${c.reset} Invalid status "${status}". Valid: ${valid.join(', ')}`);
    process.exit(1);
  }

  try {
    await cloudRequest('PATCH', '/api/history', {
      messageId,
      threadStatus: status,
    });
    console.log(`${c.green}✓${c.reset} Thread status set to ${c.cyan}${status}${c.reset}`);
  } catch (err) {
    console.log(`${c.red}✗${c.reset} ${err.message}`);
    process.exit(1);
  }

  process.exit(0);
  return true;
}

module.exports = { maybeHandleThreadCommand };
