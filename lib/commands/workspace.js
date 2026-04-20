'use strict';

const fs = require('fs');
const path = require('path');

const { slugify } = require('../storage/paths');

const CATEGORY_LABELS = new Map([
  ['repositories', 'Repositories'],
  ['docs', 'Docs'],
  ['config', 'Config'],
  ['scripts', 'Scripts'],
]);

const CATEGORY_ALIASES = new Map([
  ['repo', 'repositories'],
  ['repos', 'repositories'],
  ['repository', 'repositories'],
  ['repositories', 'repositories'],
  ['doc', 'docs'],
  ['docs', 'docs'],
  ['documentation', 'docs'],
  ['config', 'config'],
  ['configs', 'config'],
  ['configuration', 'config'],
  ['script', 'scripts'],
  ['scripts', 'scripts'],
]);

const DEFAULT_CATEGORY_ORDER = ['repositories', 'docs', 'config', 'scripts'];
const BARE_FLAGS = new Set(['--yes', '-y', '-h', '--help']);

function printWorkspaceHelp(c) {
  console.log(`${c.bold}agx workspace${c.reset} - Manage project workspace maps`);
  console.log('');
  console.log('Usage:');
  console.log('  agx workspace list [--project <slug|id>]');
  console.log('  agx workspace add <category> <name> [path] [--project <slug|id>] [--purpose <text>]');
  console.log('  agx workspace remove <category> <name> [--project <slug|id>] [--yes]');
  console.log('  agx workspace export [--project <slug|id>] [--output <path>]');
  console.log('  agx workspace import [path] [--project <slug|id>] [--yes]');
  console.log('');
  console.log('Notes:');
  console.log('  If --project is omitted, agx infers the project from the current git root.');
  console.log('  Category aliases like "repos" map to "repositories".');
}

function flag(name, argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === `--${name}`) return argv[i + 1] || null;
  }
  return null;
}

function hasFlag(name, argv) {
  return argv.includes(`--${name}`);
}

function positionalArgs(argv) {
  const result = [];
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok.startsWith('-')) {
      if (!BARE_FLAGS.has(tok) && i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        i += 1;
      }
      continue;
    }
    result.push(tok);
  }
  return result;
}

function canonicalizeWorkspaceCategory(input) {
  const normalized = String(input || '').trim().toLowerCase();
  if (!normalized) return '';
  if (CATEGORY_ALIASES.has(normalized)) return CATEGORY_ALIASES.get(normalized);
  return slugify(normalized, { maxLength: 64 });
}

function labelForWorkspaceCategory(categoryId) {
  const canonical = canonicalizeWorkspaceCategory(categoryId);
  if (CATEGORY_LABELS.has(canonical)) return CATEGORY_LABELS.get(canonical);
  return String(categoryId || '')
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ') || 'Unknown';
}

function inferProjectIdentifierFromCwd(cwd = process.cwd()) {
  let dir = cwd;
  while (dir !== path.dirname(dir)) {
    const gitPath = path.join(dir, '.git');
    try {
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory() || stat.isFile()) {
        return slugify(path.basename(dir), { maxLength: 64 });
      }
    } catch {
      // Keep walking up.
    }
    dir = path.dirname(dir);
  }
  return slugify(path.basename(cwd), { maxLength: 64 });
}

function orderedWorkspaceCategories(workspace) {
  const keys = Object.keys(workspace || {});
  const extras = keys
    .filter((category) => !DEFAULT_CATEGORY_ORDER.includes(category))
    .sort((a, b) => a.localeCompare(b));
  return [...DEFAULT_CATEGORY_ORDER, ...extras];
}

function formatWorkspaceLines(project, workspace) {
  const orderedCategories = orderedWorkspaceCategories(workspace);
  const allEntries = orderedCategories.flatMap((category) => workspace?.[category] || []);
  const nameWidth = Math.max(
    10,
    ...allEntries.map((entry) => String(entry?.name || '').length),
  );
  const purposeIndent = `  ${' '.repeat(nameWidth + 3)}`;
  const lines = [`Project: ${project?.name || project?.slug || project?.id || 'Unknown'}`, ''];

  orderedCategories.forEach((category, index) => {
    lines.push(`${labelForWorkspaceCategory(category)}/`);
    const entries = workspace?.[category] || [];
    if (entries.length === 0) {
      lines.push('  (empty)');
    } else {
      entries.forEach((entry) => {
        const name = String(entry?.name || '').trim() || '(unnamed)';
        const entryPath = typeof entry?.path === 'string' ? entry.path.trim() : '';
        const purpose = typeof entry?.purpose === 'string' ? entry.purpose.trim() : '';
        const line = entryPath
          ? `  ${name.padEnd(nameWidth, ' ')} → ${entryPath}`
          : `  ${name}`;
        lines.push(line);
        if (purpose) lines.push(`${purposeIndent}${purpose}`);
      });
    }
    if (index < orderedCategories.length - 1) lines.push('');
  });

  return lines;
}

function buildCreateBody(category, name, locationPath, purpose) {
  const body = { category, name };
  if (locationPath) body.path = locationPath;
  if (purpose) body.purpose = purpose;
  return body;
}

function normalizeApiUrl(apiUrl) {
  return String(apiUrl || '').replace(/\/$/, '');
}

function buildDirectRequestHeaders(cloudConfig, contentType = null) {
  const internalServiceToken =
    (process.env.AGX_INTERNAL_SERVICE_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || '').trim();
  const internalCallerId =
    (process.env.AGX_EXECUTOR_CALLER_ID || 'executor-engine').trim();
  const headers = {
    'x-user-id': cloudConfig?.userId || '',
    'x-agx-caller': internalCallerId,
    'x-executor-caller-id': internalCallerId,
  };

  if (contentType) headers['Content-Type'] = contentType;
  if (internalServiceToken) headers['x-internal-service-token'] = internalServiceToken;
  if (cloudConfig?.token) headers.Authorization = `Bearer ${cloudConfig.token}`;

  return headers;
}

async function parseApiError(response) {
  try {
    const data = await response.json();
    if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
  } catch {
    // Fall through to status-based fallback.
  }

  return `HTTP ${response.status}`;
}

function readWorkspaceImportSource(importPath) {
  if (!importPath || importPath === '-') {
    if (process.stdin.isTTY) {
      throw new Error('Provide a file path or pipe YAML via stdin.');
    }
    return {
      yaml: fs.readFileSync(0, 'utf8'),
      sourceLabel: 'stdin',
      usesStdin: true,
    };
  }

  const resolved = path.resolve(importPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  return {
    yaml: fs.readFileSync(resolved, 'utf8'),
    sourceLabel: resolved,
    usesStdin: false,
  };
}

async function exportWorkspaceYaml({ cloudConfig, project }) {
  const exportUrl = `${normalizeApiUrl(cloudConfig.apiUrl)}/api/projects/${project.id}/workspace/export`;
  const response = await fetch(exportUrl, {
    headers: buildDirectRequestHeaders(cloudConfig),
  });
  if (!response.ok) {
    const message = await parseApiError(response);
    throw new Error(`Export failed: ${message}`);
  }
  return response.text();
}

async function importWorkspaceYaml({ cloudConfig, project, yaml }) {
  const importUrl = `${normalizeApiUrl(cloudConfig.apiUrl)}/api/projects/${project.id}/workspace/import`;
  const response = await fetch(importUrl, {
    method: 'POST',
    headers: buildDirectRequestHeaders(cloudConfig, 'text/yaml'),
    body: yaml,
  });
  if (!response.ok) {
    const message = await parseApiError(response);
    throw new Error(`Import failed: ${message}`);
  }
  return response.json().catch(() => ({}));
}

async function maybeHandleWorkspaceCommand({ cmd, args, ctx }) {
  if (cmd !== 'workspace') return false;

  const {
    c,
    cloudRequest,
    loadCloudConfigFile,
    resolveProjectByIdentifier,
    prompt,
  } = ctx;

  const workspaceArgs = args.slice(1);
  const wantsHelp = workspaceArgs.includes('--help') || workspaceArgs.includes('-h');
  if (!workspaceArgs.length || wantsHelp) {
    printWorkspaceHelp(c);
    process.exit(wantsHelp ? 0 : 1);
  }

  const subcmd = workspaceArgs[0];
  const subArgs = workspaceArgs.slice(1);
  const skipConfirm = hasFlag('yes', subArgs) || subArgs.includes('-y');

  function requireCloudConfig() {
    const cloudConfig = loadCloudConfigFile();
    if (!cloudConfig?.apiUrl) {
      console.log(`${c.red}Board API URL not configured.${c.reset} Set AGX_BOARD_URL (legacy AGX_CLOUD_URL; default is http://localhost:41741)`);
      process.exit(1);
    }
    return cloudConfig;
  }

  async function resolveProject() {
    const explicit = flag('project', subArgs);
    const identifier = explicit || inferProjectIdentifierFromCwd();
    return resolveProjectByIdentifier(identifier);
  }

  try {
    switch (subcmd) {
      case 'list': {
        requireCloudConfig();
        const project = await resolveProject();
        const data = await cloudRequest('GET', `/api/projects/${project.id}/workspace`);
        const workspace = data?.workspace && typeof data.workspace === 'object' ? data.workspace : {};
        const lines = formatWorkspaceLines(project, workspace);
        console.log(lines.join('\n'));
        process.exit(0);
      }

      case 'add': {
        requireCloudConfig();
        const [rawCategory, rawName, rawPath] = positionalArgs(subArgs);
        const category = canonicalizeWorkspaceCategory(rawCategory);
        const name = String(rawName || '').trim();
        const locationPath = String(rawPath || '').trim();
        const purpose = String(flag('purpose', subArgs) || '').trim();

        if (!category || !name) {
          console.log(`${c.yellow}Usage:${c.reset} agx workspace add <category> <name> [path] [--project <slug|id>] [--purpose <text>]`);
          process.exit(1);
        }

        const project = await resolveProject();
        const { entry } = await cloudRequest(
          'POST',
          `/api/projects/${project.id}/workspace`,
          buildCreateBody(category, name, locationPath, purpose),
        );

        console.log(`${c.green}✓${c.reset} Workspace entry added: ${entry.name}`);
        console.log(`  Category: ${labelForWorkspaceCategory(entry.category)}`);
        if (entry.path) console.log(`  Path: ${entry.path}`);
        if (entry.purpose) console.log(`  Purpose: ${entry.purpose}`);
        process.exit(0);
      }

      case 'remove':
      case 'rm': {
        requireCloudConfig();
        const [rawCategory, rawName] = positionalArgs(subArgs);
        const category = canonicalizeWorkspaceCategory(rawCategory);
        const name = String(rawName || '').trim();

        if (!category || !name) {
          console.log(`${c.yellow}Usage:${c.reset} agx workspace remove <category> <name> [--project <slug|id>] [--yes]`);
          process.exit(1);
        }

        const project = await resolveProject();
        const data = await cloudRequest('GET', `/api/projects/${project.id}/workspace`);
        const workspace = data?.workspace && typeof data.workspace === 'object' ? data.workspace : {};
        const entries = Array.isArray(workspace[category]) ? workspace[category] : [];
        const entry = entries.find((candidate) => String(candidate?.name || '').toLowerCase() === name.toLowerCase());

        if (!entry) {
          console.log(`${c.red}✗${c.reset} Workspace entry not found: ${labelForWorkspaceCategory(category)}/${name}`);
          process.exit(1);
        }

        if (!skipConfirm) {
          console.log(`${c.bold}Remove workspace entry:${c.reset} ${entry.name}`);
          if (entry.path) console.log(`  Path: ${entry.path}`);
          const answer = await prompt('Are you sure? [y/N]: ');
          if (answer.toLowerCase() !== 'y') {
            console.log('Cancelled.');
            process.exit(0);
          }
        }

        await cloudRequest('DELETE', `/api/projects/${project.id}/workspace/${entry.id}`);
        console.log(`${c.green}✓${c.reset} Removed workspace entry: ${entry.name}`);
        process.exit(0);
      }

      case 'export': {
        const cloudConfig = requireCloudConfig();
        const project = await resolveProject();
        const outputPath = String(flag('output', subArgs) || '').trim();
        const yaml = await exportWorkspaceYaml({ cloudConfig, project });

        if (!outputPath) {
          process.stdout.write(yaml);
          process.exit(0);
        }

        const resolved = path.resolve(outputPath);
        const dir = path.dirname(resolved);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(resolved, yaml, 'utf8');
        console.log(`${c.green}✓${c.reset} Exported workspace to ${resolved}`);
        process.exit(0);
      }

      case 'import': {
        const cloudConfig = requireCloudConfig();
        const project = await resolveProject();
        const importPath = positionalArgs(subArgs)[0] || null;
        const usingPipedStdin = (!importPath || importPath === '-') && !process.stdin.isTTY;

        if (usingPipedStdin && !skipConfirm) {
          console.log(`${c.red}✗${c.reset} Importing from stdin requires --yes in non-interactive mode.`);
          process.exit(1);
        }

        const { yaml, sourceLabel } = readWorkspaceImportSource(importPath);
        if (!yaml.trim()) {
          throw new Error(`Empty workspace YAML from ${sourceLabel}`);
        }

        if (!skipConfirm) {
          console.log(`${c.bold}Import workspace from:${c.reset} ${sourceLabel}`);
          const answer = await prompt('Continue? [y/N]: ');
          if (answer.toLowerCase() !== 'y') {
            console.log('Cancelled.');
            process.exit(0);
          }
        }

        const result = await importWorkspaceYaml({ cloudConfig, project, yaml });
        const summary = result?.summary && typeof result.summary === 'object' ? result.summary : {};
        const created = Number(summary.created || 0);
        const updated = Number(summary.updated || 0);
        const total = Number(summary.total || created + updated);
        console.log(`${c.green}✓${c.reset} Imported workspace from ${sourceLabel}`);
        console.log(`  Created: ${created}`);
        console.log(`  Updated: ${updated}`);
        console.log(`  Total: ${total}`);
        process.exit(0);
      }

      default:
        console.log(`${c.yellow}Unknown workspace command:${c.reset} ${subcmd}`);
        printWorkspaceHelp(c);
        process.exit(1);
    }
  } catch (err) {
    if (err && Object.prototype.hasOwnProperty.call(err, 'exitCode')) {
      throw err;
    }
    console.log(`${c.red}✗${c.reset} ${err.message}`);
    process.exit(1);
  }

  return true;
}

module.exports = {
  maybeHandleWorkspaceCommand,
  flag,
  positionalArgs,
  canonicalizeWorkspaceCategory,
  inferProjectIdentifierFromCwd,
  formatWorkspaceLines,
  buildCreateBody,
  readWorkspaceImportSource,
  buildDirectRequestHeaders,
};
