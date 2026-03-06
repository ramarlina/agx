const { analyzeRepo, addRepoToProject } = require('../repo-cli');

function printRepoHelp(c) {
  console.log(`${c.bold}agx repo${c.reset} - Manage project repo entries`);
  console.log('');
  console.log('Usage:');
  console.log('  agx repo add [path] --project <id|slug> [--name <name>] [--notes <text>] [--json]');
  console.log('');
  console.log('Examples:');
  console.log('  agx project list');
  console.log('  agx repo add . --project agx-cloud');
  console.log('  agx repo add ../service --project 123e4567-e89b-12d3-a456-426614174000 --name API');
}

function parseRepoAddArgs(argv = []) {
  const parsed = {
    repoPath: '.',
    project: null,
    name: null,
    notes: null,
    json: false,
  };

  let repoPathAssigned = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --project');
      }
      parsed.project = value;
      i += 1;
      continue;
    }
    if (arg === '--name') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --name');
      }
      parsed.name = value;
      i += 1;
      continue;
    }
    if (arg === '--notes') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --notes');
      }
      parsed.notes = value;
      i += 1;
      continue;
    }
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option for repo add: ${arg}`);
    }
    if (!repoPathAssigned) {
      parsed.repoPath = arg;
      repoPathAssigned = true;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!parsed.project) {
    throw new Error('Project is required (--project <id|slug>)');
  }

  return parsed;
}

function printRepoAdded(c, project, repo, analysis) {
  console.log(`${c.green}✓${c.reset} Repo added to project ${project.slug || project.id}`);
  console.log(`  Name: ${repo.name}`);
  console.log(`  Path: ${repo.path}`);
  if (analysis.frameworks.length) {
    console.log(`  Frameworks: ${analysis.frameworks.join(', ')}`);
  }
  if (analysis.packageManager) {
    console.log(`  Package manager: ${analysis.packageManager}`);
  }
}

async function maybeHandleRepoCommand({ cmd, args, ctx }) {
  if (cmd !== 'repo') return false;

  const { c, cloudRequest, resolveProjectByIdentifier } = ctx;
  const repoArgs = args.slice(1);
  const wantsHelp = repoArgs.includes('--help') || repoArgs.includes('-h');
  if (!repoArgs.length || wantsHelp) {
    printRepoHelp(c);
    process.exit(wantsHelp ? 0 : 1);
  }

  const subcmd = repoArgs[0];
  const subArgs = repoArgs.slice(1);

  try {
    switch (subcmd) {
      case 'add': {
        const parsed = parseRepoAddArgs(subArgs);
        const project = await resolveProjectByIdentifier(parsed.project);
        const analysis = await analyzeRepo(parsed.repoPath, {
          allowHeuristicFallback: true,
        });
        const result = await addRepoToProject({
          project,
          repoAnalysis: analysis,
          cloudRequest,
          name: parsed.name,
          notes: parsed.notes,
        });
        const updatedProject = result?.project || project;
        const createdRepo = Array.isArray(updatedProject.repos)
          ? updatedProject.repos.find((repo) => repo.path === analysis.rootPath)
            || updatedProject.repos[updatedProject.repos.length - 1]
          : { name: parsed.name || analysis.name, path: analysis.rootPath };

        if (parsed.json) {
          console.log(JSON.stringify({
            ok: true,
            project: {
              id: updatedProject.id,
              slug: updatedProject.slug || null,
              name: updatedProject.name,
            },
            repo: createdRepo,
            analysis: {
              packageManager: analysis.packageManager,
              frameworks: analysis.frameworks,
              languages: analysis.languages,
              keyFiles: analysis.keyFiles,
            },
          }, null, 2));
        } else {
          printRepoAdded(c, updatedProject, createdRepo, analysis);
        }
        process.exit(0);
        break;
      }
      default:
        console.log(`${c.yellow}Unknown repo command:${c.reset} ${subcmd}`);
        printRepoHelp(c);
        process.exit(1);
    }
  } catch (err) {
    console.log(`${c.red}✗${c.reset} ${err.message}`);
    process.exit(1);
  }

  return true;
}

module.exports = {
  maybeHandleRepoCommand,
  parseRepoAddArgs,
};
