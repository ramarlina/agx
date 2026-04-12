function printVarsHelp(c) {
  console.log(`${c.bold}agx vars${c.reset} - Read project environment variables`);
  console.log('');
  console.log('Usage:');
  console.log('  agx vars get <project> <KEY>        Print the value of a variable');
  console.log('  agx vars list <project>             List variable keys (no values)');
}

async function maybeHandleVarsCommand({ cmd, args, ctx }) {
  if (cmd !== 'vars') return false;

  const { c, cloudRequest, resolveProjectByIdentifier } = ctx;

  const varsArgs = args.slice(1);
  const wantsHelp = varsArgs.includes('--help') || varsArgs.includes('-h');
  if (!varsArgs.length || wantsHelp) {
    printVarsHelp(c);
    process.exit(wantsHelp ? 0 : 1);
  }

  const subcmd = varsArgs[0];
  const subArgs = varsArgs.slice(1);

  try {
    switch (subcmd) {
      case 'get': {
        const projectIdentifier = subArgs[0];
        const key = subArgs[1];
        if (!projectIdentifier || !key) {
          console.log(`${c.yellow}Usage:${c.reset} agx vars get <project> <KEY>`);
          process.exit(1);
        }
        const project = await resolveProjectByIdentifier(projectIdentifier);
        const data = await cloudRequest('GET', `/api/projects/${project.id}/variables/${encodeURIComponent(key)}`);
        if (data.error) {
          console.log(`${c.red}✗${c.reset} ${data.error}`);
          process.exit(1);
        }
        process.stdout.write(data.value);
        process.exit(0);
        break;
      }
      case 'list':
      case 'ls': {
        const projectIdentifier = subArgs[0];
        if (!projectIdentifier) {
          console.log(`${c.yellow}Usage:${c.reset} agx vars list <project>`);
          process.exit(1);
        }
        const project = await resolveProjectByIdentifier(projectIdentifier);
        const data = await cloudRequest('GET', `/api/projects/${project.id}/variables`);
        const items = Array.isArray(data.variables) ? data.variables : [];
        if (items.length === 0) {
          console.log(`${c.dim}No variables set${c.reset}`);
        } else {
          for (const v of items) {
            console.log(v.key);
          }
        }
        process.exit(0);
        break;
      }
      default:
        console.log(`${c.yellow}Unknown vars command:${c.reset} ${subcmd}`);
        printVarsHelp(c);
        process.exit(1);
    }
  } catch (err) {
    console.log(`${c.red}✗${c.reset} ${err.message}`);
    process.exit(1);
  }

  return true;
}

module.exports = { maybeHandleVarsCommand };
