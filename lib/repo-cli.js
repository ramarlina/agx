const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./cli/configStore');
const { sanitizeCliArgs } = require('./cli/sanitize');
const { appendTail, truncateForTrace, randomId } = require('./cli/util');
const { spawnCloudTaskProcess } = require('./proc/spawnCloudTaskProcess');
const { scheduleTermination } = require('./proc/killProcessTree');
const { getProcessManager } = require('./proc/ProcessManager');
const { createExecutionFlowLogger } = require('./ui/executionFlow');
const { createCloudCommandHelpers } = require('./cli/cloud/command');

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function pathExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function findRepoRoot(inputPath = '.') {
  const resolvedInput = path.resolve(inputPath);
  if (!pathExists(resolvedInput)) {
    throw new Error(`Path not found: ${inputPath}`);
  }

  let current = resolvedInput;
  try {
    const stat = fs.statSync(resolvedInput);
    if (!stat.isDirectory()) {
      current = path.dirname(resolvedInput);
    }
  } catch {
    current = path.dirname(resolvedInput);
  }

  let dir = current;
  while (true) {
    if (pathExists(path.join(dir, '.git'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return current;
    }
    dir = parent;
  }
}

function resolveAnalysisPath(inputPath = '.') {
  const resolvedInput = path.resolve(inputPath);
  if (!pathExists(resolvedInput)) {
    throw new Error(`Path not found: ${inputPath}`);
  }

  try {
    const stat = fs.statSync(resolvedInput);
    return stat.isDirectory() ? resolvedInput : path.dirname(resolvedInput);
  } catch {
    return path.dirname(resolvedInput);
  }
}

function detectPackageManager(rootPath) {
  if (pathExists(path.join(rootPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (pathExists(path.join(rootPath, 'yarn.lock'))) return 'yarn';
  if (pathExists(path.join(rootPath, 'bun.lockb')) || pathExists(path.join(rootPath, 'bun.lock'))) return 'bun';
  if (pathExists(path.join(rootPath, 'package-lock.json'))) return 'npm';
  return null;
}

function detectLanguages(rootPath, packageJson) {
  const languages = [];
  if (packageJson) languages.push('JavaScript');
  if (pathExists(path.join(rootPath, 'tsconfig.json'))) languages.push('TypeScript');
  if (pathExists(path.join(rootPath, 'pyproject.toml')) || pathExists(path.join(rootPath, 'requirements.txt'))) languages.push('Python');
  if (pathExists(path.join(rootPath, 'go.mod'))) languages.push('Go');
  if (pathExists(path.join(rootPath, 'Cargo.toml'))) languages.push('Rust');
  return Array.from(new Set(languages));
}

function detectFrameworks(packageJson = {}) {
  const deps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };

  const frameworks = [];
  const checks = [
    ['next', 'Next.js'],
    ['react', 'React'],
    ['vue', 'Vue'],
    ['svelte', 'Svelte'],
    ['express', 'Express'],
    ['fastify', 'Fastify'],
    ['nestjs', 'NestJS'],
    ['tailwindcss', 'Tailwind CSS'],
    ['jest', 'Jest'],
    ['vitest', 'Vitest'],
    ['playwright', 'Playwright'],
    ['typescript', 'TypeScript'],
  ];

  for (const [pkgName, label] of checks) {
    if (deps[pkgName]) frameworks.push(label);
  }

  return frameworks;
}

function detectKeyFiles(rootPath) {
  const candidates = [
    'package.json',
    'tsconfig.json',
    'pnpm-workspace.yaml',
    'turbo.json',
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
    'README.md',
    'next.config.js',
    'next.config.mjs',
    'vite.config.ts',
    'vite.config.js',
    'pyproject.toml',
    'requirements.txt',
    'go.mod',
    'Cargo.toml',
  ];

  return candidates.filter((name) => pathExists(path.join(rootPath, name)));
}

function extractReadmeSummary(rootPath) {
  const readme = safeReadText(path.join(rootPath, 'README.md')).trim();
  if (!readme) return null;
  const lines = readme
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'));
  return lines[0] || null;
}

function buildRepoNotes(analysis) {
  const lines = [
    'Auto-generated repo notes from local analysis.',
    '',
    'Summary',
    `- Root: ${analysis.rootPath}`,
  ];

  if (analysis.readmeSummary) {
    lines.push(`- Description: ${analysis.readmeSummary}`);
  }
  if (analysis.languages.length) {
    lines.push(`- Languages: ${analysis.languages.join(', ')}`);
  }
  if (analysis.packageManager) {
    lines.push(`- Package manager: ${analysis.packageManager}`);
  }
  if (analysis.frameworks.length) {
    lines.push(`- Frameworks/tooling: ${analysis.frameworks.join(', ')}`);
  }
  if (analysis.workspace) {
    lines.push('- Workspace repo: yes');
  }
  if (analysis.scripts.length) {
    lines.push(`- Common scripts: ${analysis.scripts.join(', ')}`);
  }
  if (analysis.keyFiles.length) {
    lines.push(`- Key files: ${analysis.keyFiles.join(', ')}`);
  }

  return lines.join('\n');
}

function safeListTopLevel(rootPath, limit = 20) {
  try {
    return fs.readdirSync(rootPath, { withFileTypes: true })
      .map((entry) => `${entry.isDirectory() ? 'dir' : 'file'}:${entry.name}`)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function buildRepoAnalysisPrompt(analysis) {
  const readme = safeReadText(path.join(analysis.rootPath, 'README.md')).trim().slice(0, 4000);
  const packageJson = safeReadText(path.join(analysis.rootPath, 'package.json')).trim().slice(0, 4000);
  const topLevel = safeListTopLevel(analysis.rootPath);

  return [
    'You are generating concise repo notes for an AI agent system.',
    'Analyze the provided local folder context and produce a short repo note.',
    'Return plain text only. Do not use markdown code fences.',
    'Use this exact structure:',
    'Auto-generated repo notes from local analysis.',
    '',
    'Summary',
    '- Root: <absolute path>',
    '- Description: ...',
    '- Primary purpose: ...',
    '- Languages: ...',
    '- Package manager: ...',
    '- Frameworks/tooling: ...',
    '- Common scripts: ...',
    '- Key files: ...',
    '- Architecture notes: ...',
    '',
    'Rules:',
    '- Analyze only the provided folder as the repo root.',
    '- Treat that folder as the repo even if there is no .git directory.',
    '- Do not replace the root path with a parent git root.',
    '- Omit lines you cannot support from the provided context.',
    '- Keep each line concise and specific.',
    '',
    `Repo root: ${analysis.rootPath}`,
    `Detected name: ${analysis.name}`,
    `Detected package manager: ${analysis.packageManager || '(none)'}`,
    `Detected languages: ${analysis.languages.join(', ') || '(none)'}`,
    `Detected frameworks/tooling: ${analysis.frameworks.join(', ') || '(none)'}`,
    `Detected scripts: ${analysis.scripts.join(', ') || '(none)'}`,
    `Detected key files: ${analysis.keyFiles.join(', ') || '(none)'}`,
    `Workspace repo flag: ${analysis.workspace ? 'yes' : 'no'}`,
    `Top-level entries: ${topLevel.join(', ') || '(none)'}`,
    '',
    'README excerpt:',
    readme || '(none)',
    '',
    'package.json excerpt:',
    packageJson || '(none)',
  ].join('\n');
}

function createRepoRunAgxCommand() {
  const logExecutionFlow = createExecutionFlowLogger({ shouldLog: () => false });
  return createCloudCommandHelpers({
    sanitizeCliArgs,
    logExecutionFlow,
    spawnCloudTaskProcess,
    randomId,
    appendTail,
    truncateForTrace,
    scheduleTermination,
    getProcessManager,
  }).runAgxCommand;
}

async function generateRepoNotesWithLlm(analysis, options = {}) {
  const config = options.config || loadConfig() || {};
  const provider = options.provider || config.defaultProvider;
  if (!provider) {
    throw new Error('No default provider configured for repo analysis');
  }

  const model = options.model
    || config?.models?.[provider]
    || (provider === 'ollama' ? config?.ollama?.model : null)
    || null;
  const runAgxCommand = options.runAgxCommand || createRepoRunAgxCommand();
  const prompt = buildRepoAnalysisPrompt(analysis);
  const args = [provider, '-y', '--print', '-p', prompt];
  if (model) args.push('--model', model);

  const cliEntrypoint = path.resolve(__dirname, '..', 'index.js');
  const previousArgv1 = process.argv[1];
  if (!process.argv[1]) {
    process.argv[1] = cliEntrypoint;
  }

  let result;
  try {
    result = await runAgxCommand(
      args,
      options.timeoutMs || 180000,
      `agx ${provider} repo-analysis`,
      { cwd: analysis.rootPath }
    );
  } finally {
    process.argv[1] = previousArgv1;
  }
  const output = String(result?.stdout || '').trim();
  if (!output) {
    throw new Error('LLM repo analysis returned empty output');
  }
  return { provider, model, notes: output };
}

async function analyzeRepo(inputPath = '.', options = {}) {
  const rootPath = resolveAnalysisPath(inputPath);
  const packageJson = safeReadJson(path.join(rootPath, 'package.json'));
  const detectedName = typeof packageJson?.name === 'string' && packageJson.name.trim()
    ? packageJson.name.trim().split('/').pop()
    : path.basename(rootPath);
  const packageManager = detectPackageManager(rootPath);
  const languages = detectLanguages(rootPath, packageJson);
  const frameworks = detectFrameworks(packageJson || {});
  const keyFiles = detectKeyFiles(rootPath);
  const workspace = Boolean(packageJson?.workspaces) || pathExists(path.join(rootPath, 'pnpm-workspace.yaml'));
  const scripts = packageJson?.scripts ? Object.keys(packageJson.scripts).slice(0, 8) : [];
  const readmeSummary = extractReadmeSummary(rootPath);

  const analysis = {
    name: detectedName,
    rootPath,
    packageManager,
    languages,
    frameworks,
    keyFiles,
    workspace,
    scripts,
    readmeSummary,
  };

  if (options.llm !== false) {
    try {
      const llmResult = await generateRepoNotesWithLlm(analysis, options);
      return {
        ...analysis,
        noteProvider: llmResult.provider,
        noteModel: llmResult.model,
        notes: llmResult.notes,
      };
    } catch (error) {
      if (!options.allowHeuristicFallback) {
        throw error;
      }
    }
  }

  return {
    ...analysis,
    notes: buildRepoNotes(analysis),
  };
}

async function addRepoToProject({ project, repoAnalysis, cloudRequest, name, notes }) {
  if (!project?.id) {
    throw new Error('Project is required');
  }
  if (!repoAnalysis?.rootPath) {
    throw new Error('Repo analysis is required');
  }
  if (typeof cloudRequest !== 'function') {
    throw new Error('cloudRequest function is required');
  }

  const existingRepos = Array.isArray(project.repos) ? project.repos : [];
  const normalizedPath = path.resolve(repoAnalysis.rootPath);
  const duplicate = existingRepos.find((repo) => path.resolve(repo.path || '') === normalizedPath);
  if (duplicate) {
    throw new Error(`Project already contains repo at ${normalizedPath}`);
  }

  const finalName = typeof name === 'string' && name.trim() ? name.trim() : repoAnalysis.name;
  const noteParts = [repoAnalysis.notes];
  if (typeof notes === 'string' && notes.trim()) {
    noteParts.push('', 'Additional notes', notes.trim());
  }
  const finalNotes = noteParts.join('\n').trim();

  const nextRepos = [
    ...existingRepos.map((repo) => ({
      name: repo.name,
      path: repo.path,
      git_url: repo.git_url,
      notes: repo.notes,
    })),
    {
      name: finalName,
      path: normalizedPath,
      notes: finalNotes || undefined,
    },
  ];

  return cloudRequest('PATCH', `/api/projects/${project.id}`, { repos: nextRepos });
}

module.exports = {
  analyzeRepo,
  addRepoToProject,
  buildRepoNotes,
  findRepoRoot,
  generateRepoNotesWithLlm,
};
