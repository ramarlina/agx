function formatProjectMetadataEntries(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  return Object.entries(metadata);
}

function printProjectSummary(c, project) {
  if (!project) return;
  const slugSuffix = project.slug ? ` (${project.slug})` : '';
  console.log(`${c.bold}${project.name || '(unnamed project)'}${c.reset}${slugSuffix}`);
  console.log(`  ID: ${project.id}`);
  if (project.description) {
    console.log(`  Description: ${project.description}`);
  }
}

function printProjectDetails(c, project) {
  if (!project) return;
  printProjectSummary(c, project);
  if (project.ci_cd_info) {
    console.log(`  CI/CD: ${project.ci_cd_info}`);
  }
  if (project.workflow_id) {
    console.log(`  Workflow: ${project.workflow_id}`);
  }
  const metadataEntries = formatProjectMetadataEntries(project.metadata);
  if (metadataEntries.length) {
    console.log('  Metadata:');
    metadataEntries.forEach(([key, value]) => {
      console.log(`    ${key}: ${value}`);
    });
  }
  if (Array.isArray(project.repos) && project.repos.length) {
    console.log('  Repos:');
    project.repos.forEach((repo) => {
      const parts = [repo.name];
      if (repo.path) parts.push(`path: ${repo.path}`);
      if (repo.git_url) parts.push(`git_url: ${repo.git_url}`);
      if (repo.notes) parts.push(`notes: ${repo.notes}`);
      console.log(`    - ${parts.join(' | ')}`);
    });
  }
}

function printProjectHelp(c) {
  console.log(`${c.bold}agx project${c.reset} - Manage structured project metadata`);
  console.log('');
  console.log('Usage:');
  console.log('  agx project list');
  console.log('  agx project get <id|slug>');
  console.log('  agx project create --name <name> [--slug <slug>] [--description <text>] [--ci <info>] [--workflow <id>]');
  console.log('                    [--metadata key=value] [--repo \'{"name":"repo","path":"/code"}\']');
  console.log('  agx project update <id|slug> [--name <name>] [--slug <slug>] [--description <text>]');
  console.log('                    [--ci <info>] [--workflow <id>] [--metadata key=value] [--repo <json>]');
  console.log('  agx project assign <id|slug> --task <task>');
  console.log('  agx project unassign --task <task>');
  console.log('');
  console.log('Flags:');
  console.log('  --name <name>               Project name (required for create)');
  console.log('  --slug <slug>               Optional canonical slug');
  console.log('  --description <text>        Human-friendly description');
  console.log('  --ci, --ci-info <info>      CI/CD notes');
  console.log('  --workflow, --workflow-id <id>  Workflow reference');
  console.log('  --metadata key=value        Attach metadata entries (repeatable)');
  console.log('  --repo <json>               Describe repo info (repeatable; JSON)');
  console.log('  --task, -t                  Task identifier for assign/unassign');
}

function getTaskFlagValue(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--task' || argv[i] === '-t') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) return next;
    }
  }
  return null;
}

async function maybeHandleProjectCommand({ cmd, args, ctx }) {
  if (cmd !== 'project') return false;

  const {
    c,
    cloudRequest,
    loadCloudConfigFile,
    resolveProjectByIdentifier,
    resolveTaskId,
    collectProjectFlags,
    buildProjectBody,
    createProject,
  } = ctx;

  const projectArgs = args.slice(1);
  const wantsHelp = projectArgs.includes('--help') || projectArgs.includes('-h');
  if (!projectArgs.length || wantsHelp) {
    printProjectHelp(c);
    process.exit(wantsHelp ? 0 : 1);
  }

  const cloudConfig = loadCloudConfigFile();
  if (!cloudConfig?.apiUrl) {
    console.log(`${c.red}Cloud API URL not configured.${c.reset} Set AGX_CLOUD_URL (default is http://localhost:41741)`);
    process.exit(1);
  }

  const subcmd = projectArgs[0];
  const subArgs = projectArgs.slice(1);

  try {
    switch (subcmd) {
      case 'list': {
        const { projects } = await cloudRequest('GET', '/api/projects');
        const items = Array.isArray(projects) ? projects : [];
        if (items.length === 0) {
          console.log(`${c.dim}No projects found${c.reset}`);
        } else {
          console.log(`${c.bold}Projects (${items.length})${c.reset}`);
          items.forEach((project, index) => {
            printProjectSummary(c, project);
            if (index < items.length - 1) console.log('');
          });
        }
        process.exit(0);
        break;
      }
      case 'get': {
        const identifier = subArgs[0];
        if (!identifier) {
          console.log(`${c.yellow}Usage:${c.reset} agx project get <id|slug>`);
          process.exit(1);
        }
        const project = await resolveProjectByIdentifier(identifier);
        printProjectDetails(c, project);
        process.exit(0);
        break;
      }
      case 'create': {
        const flags = collectProjectFlags(subArgs);
        const { project } = await createProject(flags, cloudRequest);
        console.log(`${c.green}✓${c.reset} Project created: ${project.name} (${project.slug || project.id})`);
        printProjectDetails(c, project);
        process.exit(0);
        break;
      }
      case 'update': {
        const identifier = subArgs[0];
        if (!identifier) {
          console.log(`${c.yellow}Usage:${c.reset} agx project update <id|slug> [flags]`);
          process.exit(1);
        }
        const flags = collectProjectFlags(subArgs.slice(1));
        const body = buildProjectBody(flags);
        if (!Object.keys(body).length) {
          throw new Error('At least one field must be specified to update a project.');
        }
        const targetProject = await resolveProjectByIdentifier(identifier);
        const { project } = await cloudRequest('PATCH', `/api/projects/${targetProject.id}`, body);
        console.log(`${c.green}✓${c.reset} Project updated: ${project.name} (${project.slug || project.id})`);
        printProjectDetails(c, project);
        process.exit(0);
        break;
      }
      case 'assign': {
        const projectIdentifier = subArgs[0];
        if (!projectIdentifier) {
          console.log(`${c.yellow}Usage:${c.reset} agx project assign <id|slug> --task <task>`);
          process.exit(1);
        }
        const taskIdentifier = getTaskFlagValue(subArgs);
        if (!taskIdentifier) {
          console.log(`${c.yellow}Usage:${c.reset} agx project assign <id|slug> --task <task>`);
          process.exit(1);
        }
        const project = await resolveProjectByIdentifier(projectIdentifier);
        const resolvedTaskId = await resolveTaskId(taskIdentifier);
        await cloudRequest('PATCH', `/api/tasks/${resolvedTaskId}`, {
          project: project.slug || project.id,
          project_id: project.id,
        });
        console.log(`${c.green}✓${c.reset} Task ${resolvedTaskId} assigned to project ${project.slug || project.id}`);
        process.exit(0);
        break;
      }
      case 'unassign': {
        const taskIdentifier = getTaskFlagValue(subArgs);
        if (!taskIdentifier) {
          console.log(`${c.yellow}Usage:${c.reset} agx project unassign --task <task>`);
          process.exit(1);
        }
        const resolvedTaskId = await resolveTaskId(taskIdentifier);
        await cloudRequest('PATCH', `/api/tasks/${resolvedTaskId}`, {
          project: null,
          project_id: null,
        });
        console.log(`${c.green}✓${c.reset} Task ${resolvedTaskId} removed from its project`);
        process.exit(0);
        break;
      }
      default:
        console.log(`${c.yellow}Unknown project command:${c.reset} ${subcmd}`);
        printProjectHelp(c);
        process.exit(1);
    }
  } catch (err) {
    console.log(`${c.red}✗${c.reset} ${err.message}`);
    process.exit(1);
  }

  return true;
}

module.exports = { maybeHandleProjectCommand };
