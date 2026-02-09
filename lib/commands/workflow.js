async function maybeHandleWorkflowCommand({ cmd, args, ctx }) {
  if (cmd !== 'workflow') return false;
  const { c, cloudRequest } = ctx;

  const { handleWorkflowCommand } = require('../workflow-cli');
  const workflowArgs = args.slice(1);
  try {
    await handleWorkflowCommand(workflowArgs, cloudRequest);
    process.exit(0);
  } catch (err) {
    console.log(`${c.red}✗${c.reset} ${err.message}`);
    process.exit(1);
  }
  return true;
}

module.exports = { maybeHandleWorkflowCommand };

