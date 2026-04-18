'use strict';

const fs = require('fs');
const path = require('path');

function printTeamsHelp(c) {
  console.log(`${c.bold}agx teams${c.reset} - Manage project teams`);
  console.log('');
  console.log('Usage:');
  console.log('  agx teams list --project <slug|id>');
  console.log('  agx teams add <template> --project <slug|id> [--variant <id>] [--name <name>] [--yes]');
  console.log('  agx teams remove <name|id> --project <slug|id> [--yes]');
  console.log('  agx teams export --project <slug|id> [--output <path>]');
  console.log('  agx teams import [path] --project <slug|id> [--yes]');
  console.log('  agx teams templates');
  console.log('');
  console.log('Flags:');
  console.log('  --project <slug|id>   Project to operate on (required except for templates)');
  console.log('  --variant <id>        Template variant to use');
  console.log('  --name <name>         Override team name');
  console.log('  --output <path>       Output path for export (default: .agx/teams.yaml)');
  console.log('  --yes, -y             Skip confirmation prompts');
}

function flag(name, argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}`) return argv[i + 1] || null;
  }
  return null;
}

function hasFlag(name, argv) {
  return argv.includes(`--${name}`);
}

/** Extract positional args by skipping --flag value pairs and bare flags. */
function positionalArgs(argv) {
  const result = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('-')) {
      // Skip the flag's value if it looks like --key value (not another flag)
      if (argv[i].startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        i++;
      }
    } else {
      result.push(argv[i]);
    }
  }
  return result;
}

async function maybeHandleTeamsCommand({ cmd, args, ctx }) {
  if (cmd !== 'teams') return false;

  const {
    c,
    cloudRequest,
    loadCloudConfigFile,
    resolveProjectByIdentifier,
    prompt,
  } = ctx;

  const teamsArgs = args.slice(1);
  const wantsHelp = teamsArgs.includes('--help') || teamsArgs.includes('-h');
  if (!teamsArgs.length || wantsHelp) {
    printTeamsHelp(c);
    process.exit(wantsHelp ? 0 : 1);
  }

  const subcmd = teamsArgs[0];
  const subArgs = teamsArgs.slice(1);
  const skipConfirm = hasFlag('yes', subArgs) || subArgs.includes('-y');

  function ensureCloud() {
    const cloudConfig = loadCloudConfigFile();
    if (!cloudConfig?.apiUrl) {
      console.log(`${c.red}Board API URL not configured.${c.reset} Set AGX_BOARD_URL (legacy AGX_CLOUD_URL; default is http://localhost:41741)`);
      process.exit(1);
    }
  }

  async function resolveProject() {
    const identifier = flag('project', subArgs);
    if (!identifier) {
      console.log(`${c.yellow}--project <slug|id> is required${c.reset}`);
      process.exit(1);
    }
    return resolveProjectByIdentifier(identifier);
  }

  try {
    switch (subcmd) {
      case 'list': {
        ensureCloud();
        const project = await resolveProject();
        const { teams } = await cloudRequest('GET', `/api/projects/${project.id}/teams`);
        const items = Array.isArray(teams) ? teams : [];
        if (items.length === 0) {
          console.log(`${c.dim}No teams found${c.reset}`);
        } else {
          console.log(`${c.bold}Teams (${items.length})${c.reset}`);
          console.log('');
          for (const team of items) {
            const agentCount = Array.isArray(team.agents) ? team.agents.length : 0;
            const origin = team.template_id || 'custom';
            console.log(`  ${c.bold}${team.name}${c.reset}`);
            console.log(`    ID: ${team.id}`);
            console.log(`    Agents: ${agentCount}`);
            console.log(`    Template: ${origin}`);
            console.log('');
          }
        }
        process.exit(0);
        break;
      }

      case 'add': {
        ensureCloud();
        const templateId = positionalArgs(subArgs)[0];
        if (!templateId) {
          console.log(`${c.yellow}Usage:${c.reset} agx teams add <template> --project <slug|id>`);
          console.log(`Run ${c.bold}agx teams templates${c.reset} to see available templates.`);
          process.exit(1);
        }
        const project = await resolveProject();
        const variantId = flag('variant', subArgs);
        const name = flag('name', subArgs);

        // Preview what will be created
        const body = { templateId };
        if (variantId) body.variantId = variantId;
        if (name) body.name = name;

        if (!skipConfirm) {
          // Fetch template info for preview
          try {
            const { templates } = await cloudRequest('GET', '/api/teams/templates');
            const tmpl = Array.isArray(templates) ? templates.find(t => t.id === templateId) : null;
            if (tmpl) {
              const variant = variantId && tmpl.variants ? tmpl.variants.find(v => v.id === variantId) : null;
              const agents = variant ? variant.agents : tmpl.agents;
              const teamName = name || (variant ? variant.name : tmpl.name);
              console.log(`${c.bold}Adding team: ${teamName}${c.reset}`);
              console.log(`  Template: ${tmpl.name}${variant ? ` (${variant.name})` : ''}`);
              console.log(`  Agents (${agents.length}):`);
              for (const agent of agents) {
                console.log(`    - ${agent.name} — ${agent.role}`);
              }
              console.log('');
            }
          } catch {
            // Template preview failed — proceed with confirmation anyway
          }

          const answer = await prompt('Create this team? [Y/n]: ');
          if (answer.toLowerCase() === 'n') {
            console.log('Cancelled.');
            process.exit(0);
          }
        }

        const { team } = await cloudRequest('POST', `/api/projects/${project.id}/teams`, body);
        const agentCount = Array.isArray(team.agents) ? team.agents.length : 0;
        console.log(`${c.green}✓${c.reset} Team created: ${team.name} (${agentCount} agents)`);
        process.exit(0);
        break;
      }

      case 'remove':
      case 'rm': {
        ensureCloud();
        const teamIdentifier = positionalArgs(subArgs)[0];
        if (!teamIdentifier) {
          console.log(`${c.yellow}Usage:${c.reset} agx teams remove <name|id> --project <slug|id>`);
          process.exit(1);
        }
        const project = await resolveProject();

        // Resolve team by name or ID
        const { teams } = await cloudRequest('GET', `/api/projects/${project.id}/teams`);
        const items = Array.isArray(teams) ? teams : [];
        const team = items.find(t =>
          t.id === teamIdentifier ||
          t.name.toLowerCase() === teamIdentifier.toLowerCase()
        );
        if (!team) {
          console.log(`${c.red}✗${c.reset} Team not found: ${teamIdentifier}`);
          if (items.length > 0) {
            console.log(`  Available teams: ${items.map(t => t.name).join(', ')}`);
          }
          process.exit(1);
        }

        if (!skipConfirm) {
          const agentCount = Array.isArray(team.agents) ? team.agents.length : 0;
          console.log(`${c.bold}Remove team: ${team.name}${c.reset} (${agentCount} agents)`);
          const answer = await prompt('Are you sure? [y/N]: ');
          if (answer.toLowerCase() !== 'y') {
            console.log('Cancelled.');
            process.exit(0);
          }
        }

        await cloudRequest('DELETE', `/api/projects/${project.id}/teams/${team.id}`);
        console.log(`${c.green}✓${c.reset} Removed team: ${team.name}`);
        process.exit(0);
        break;
      }

      case 'export': {
        ensureCloud();
        const project = await resolveProject();
        const outputPath = flag('output', subArgs) || path.join('.agx', 'teams.yaml');
        const resolved = path.resolve(outputPath);

        // cloudRequest always parses JSON — export returns YAML, so fetch directly
        const { loadCloudConfigFile: loadCfg } = require('../config/cloudConfig');
        const cfg = loadCfg();
        const exportUrl = `${cfg.apiUrl}/api/projects/${project.id}/teams/export`;
        const res = await fetch(exportUrl, { headers: { 'x-user-id': cfg.userId || '' } });
        if (!res.ok) {
          throw new Error(`Export failed: HTTP ${res.status}`);
        }
        const yaml = await res.text();

        const dir = path.dirname(resolved);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(resolved, yaml, 'utf8');
        console.log(`${c.green}✓${c.reset} Exported teams to ${resolved}`);
        process.exit(0);
        break;
      }

      case 'import': {
        ensureCloud();
        const project = await resolveProject();
        const importPath = positionalArgs(subArgs)[0] || path.join('.agx', 'teams.yaml');
        const resolved = path.resolve(importPath);

        if (!fs.existsSync(resolved)) {
          console.log(`${c.red}✗${c.reset} File not found: ${resolved}`);
          process.exit(1);
        }

        const yaml = fs.readFileSync(resolved, 'utf8');

        if (!skipConfirm) {
          console.log(`${c.bold}Import teams from:${c.reset} ${resolved}`);
          console.log(`${c.yellow}Warning:${c.reset} This will replace all existing teams in the project.`);
          const answer = await prompt('Continue? [y/N]: ');
          if (answer.toLowerCase() !== 'y') {
            console.log('Cancelled.');
            process.exit(0);
          }
        }

        // cloudRequest always JSON-serializes body — import expects raw YAML, so fetch directly
        const { loadCloudConfigFile: loadCfg2 } = require('../config/cloudConfig');
        const cfg2 = loadCfg2();
        const importUrl = `${cfg2.apiUrl}/api/projects/${project.id}/teams/import`;
        const importRes = await fetch(importUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/yaml',
            'x-user-id': cfg2.userId || '',
          },
          body: yaml,
        });
        if (!importRes.ok) {
          const errData = await importRes.json().catch(() => null);
          throw new Error(errData?.error || `Import failed: HTTP ${importRes.status}`);
        }
        const result = await importRes.json().catch(() => ({}));
        const count = Array.isArray(result.teams) ? result.teams.length : 0;
        console.log(`${c.green}✓${c.reset} Imported ${count} team(s) from ${resolved}`);
        process.exit(0);
        break;
      }

      case 'templates': {
        ensureCloud();
        const { templates } = await cloudRequest('GET', '/api/teams/templates');
        const items = Array.isArray(templates) ? templates : [];
        if (items.length === 0) {
          console.log(`${c.dim}No templates available${c.reset}`);
        } else {
          console.log(`${c.bold}Team Templates (${items.length})${c.reset}`);
          console.log('');
          for (const tmpl of items) {
            const agentCount = Array.isArray(tmpl.agents) ? tmpl.agents.length : 0;
            const variants = Array.isArray(tmpl.variants) ? tmpl.variants : [];
            console.log(`  ${c.bold}${tmpl.id}${c.reset} — ${tmpl.name}`);
            console.log(`    ${tmpl.description}`);
            console.log(`    Agents: ${agentCount}`);
            if (variants.length > 0) {
              console.log(`    Variants: ${variants.map(v => v.id).join(', ')}`);
            }
            console.log('');
          }
        }
        process.exit(0);
        break;
      }

      default:
        console.log(`${c.yellow}Unknown teams command:${c.reset} ${subcmd}`);
        printTeamsHelp(c);
        process.exit(1);
    }
  } catch (err) {
    console.log(`${c.red}✗${c.reset} ${err.message}`);
    process.exit(1);
  }

  return true;
}

module.exports = { maybeHandleTeamsCommand };
