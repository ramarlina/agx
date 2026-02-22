async function maybeHandleGateCommand({ cmd, args, ctx }) {
  if (cmd !== 'approve' && cmd !== 'reject') return false;
  const { c, cloudRequest, resolveTaskId } = ctx;
  const approved = cmd === 'approve';

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`agx ${cmd} - ${approved ? 'Approve' : 'Reject'} an awaiting gate

USAGE:
  agx ${cmd} <task>                    Auto-find the awaiting gate node
  agx ${cmd} <task> --node <nodeId>    Target a specific gate node
  agx ${cmd} <task> -m "feedback"      ${approved ? 'Approve' : 'Reject'} with feedback

OPTIONS:
  --node <nodeId>    Specify gate node ID (required if multiple gates await)
  -m, --message      Feedback message`);
    process.exit(0);
  }

  // Parse: agx approve <task> [--node <nodeId>] [-m <feedback>]
  const positional = [];
  let nodeId = null;
  let feedback = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--node' && args[i + 1]) {
      nodeId = args[++i];
    } else if ((args[i] === '-m' || args[i] === '--message') && args[i + 1]) {
      feedback = args[++i];
    } else if (!args[i].startsWith('-')) {
      positional.push(args[i]);
    }
  }

  const rawTaskId = positional[0];
  if (!rawTaskId) {
    console.log(`${c.red}✗${c.reset} Usage: agx ${cmd} <task> [--node <nodeId>] [-m <feedback>]`);
    process.exit(1);
  }

  const taskId = await resolveTaskId(rawTaskId);

  // If no --node, auto-find the awaiting gate
  if (!nodeId) {
    const graphRes = await cloudRequest('GET', `/api/tasks/${taskId}/graph`);
    const graphData = graphRes?.graph || graphRes;
    const rawNodes = graphData?.nodes || {};
    const nodeEntries = Array.isArray(rawNodes)
      ? rawNodes.map(n => [n.id, n])
      : Object.entries(rawNodes);
    const awaitingNodes = nodeEntries.filter(([, n]) => n.status === 'awaiting_human');

    if (awaitingNodes.length === 0) {
      console.log(`${c.red}✗${c.reset} No gates awaiting approval on this task.`);
      process.exit(1);
    }

    if (awaitingNodes.length > 1) {
      console.log(`${c.yellow}Multiple gates awaiting approval:${c.reset}`);
      for (const [id, n] of awaitingNodes) {
        console.log(`  ${c.cyan}${id}${c.reset}  ${n.title || n.label || n.type || id}`);
      }
      console.log(`\nSpecify one with ${c.cyan}--node <nodeId>${c.reset}`);
      process.exit(1);
    }

    nodeId = awaitingNodes[0][0];
  }

  const graphVerRes = await cloudRequest('GET', `/api/tasks/${taskId}/graph`);
  const graphVerData = graphVerRes?.graph || graphVerRes;
  const graphVersion = graphVerData.version || graphVerData.graphVersion || 0;

  const body = {
    approved,
    ifMatchGraphVersion: graphVersion,
  };
  if (feedback) body.feedback = feedback;

  const result = await cloudRequest('POST', `/api/tasks/${taskId}/nodes/${nodeId}/verify`, body);
  const newVersion = result.graphVersion || result.version || graphVersion + 1;
  const nodeName = nodeId;
  const action = approved ? 'approved' : 'rejected';
  const icon = approved ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;

  console.log(`${icon} Gate "${nodeName}" ${action} (graph v${graphVersion} → v${newVersion})`);
  if (feedback) console.log(`  feedback: ${feedback}`);

  process.exit(0);
  return true;
}

module.exports = { maybeHandleGateCommand };
