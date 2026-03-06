const fs = require('fs');
const os = require('os');
const path = require('path');

const { analyzeRepo, addRepoToProject, findRepoRoot, generateRepoNotesWithLlm } = require('../../lib/repo-cli');

describe('repo-cli helpers', () => {
  let testDir;

  beforeEach(async () => {
    testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agx-repo-cli-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  });

  test('findRepoRoot walks up to the git root', async () => {
    const repoRoot = path.join(testDir, 'workspace');
    const nested = path.join(repoRoot, 'packages', 'app');
    await fs.promises.mkdir(path.join(repoRoot, '.git'), { recursive: true });
    await fs.promises.mkdir(nested, { recursive: true });

    expect(findRepoRoot(nested)).toBe(repoRoot);
  });

  test('analyzeRepo detects package manager, frameworks, and notes', async () => {
    await fs.promises.writeFile(path.join(testDir, 'package.json'), JSON.stringify({
      name: '@acme/web',
      scripts: {
        dev: 'next dev',
        build: 'next build',
        lint: 'eslint .',
      },
      dependencies: {
        next: '15.0.0',
        react: '19.0.0',
      },
      devDependencies: {
        typescript: '5.0.0',
        jest: '30.0.0',
      },
    }, null, 2));
    await fs.promises.writeFile(path.join(testDir, 'package-lock.json'), '');
    await fs.promises.writeFile(path.join(testDir, 'tsconfig.json'), '{}');
    await fs.promises.writeFile(path.join(testDir, 'README.md'), '# Web\n\nFrontend app for the platform.\n');

    const analysis = await analyzeRepo(testDir, { llm: false });

    expect(analysis.name).toBe('web');
    expect(analysis.packageManager).toBe('npm');
    expect(analysis.frameworks).toEqual(expect.arrayContaining(['Next.js', 'React', 'TypeScript', 'Jest']));
    expect(analysis.languages).toEqual(expect.arrayContaining(['JavaScript', 'TypeScript']));
    expect(analysis.notes).toContain('Frontend app for the platform.');
    expect(analysis.notes).toContain('Common scripts: dev, build, lint');
  });

  test('analyzeRepo preserves the selected path for nested packages', async () => {
    const repoRoot = path.join(testDir, 'monorepo');
    const packageDir = path.join(repoRoot, 'apps', 'cloud');
    await fs.promises.mkdir(path.join(repoRoot, '.git'), { recursive: true });
    await fs.promises.mkdir(packageDir, { recursive: true });
    await fs.promises.writeFile(path.join(repoRoot, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    await fs.promises.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
      name: '@acme/cloud',
      scripts: { dev: 'next dev' },
      dependencies: { next: '15.0.0' },
    }, null, 2));

    const analysis = await analyzeRepo(packageDir, { llm: false });

    expect(analysis.rootPath).toBe(packageDir);
    expect(analysis.notes).toContain(`- Root: ${packageDir}`);
    expect(analysis.notes).not.toContain('VCS root:');
  });

  test('analyzeRepo works without any git metadata', async () => {
    const packageDir = path.join(testDir, 'standalone');
    await fs.promises.mkdir(packageDir, { recursive: true });
    await fs.promises.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
      name: '@acme/standalone',
      scripts: { test: 'jest' },
      devDependencies: { jest: '30.0.0' },
    }, null, 2));

    const analysis = await analyzeRepo(packageDir, { llm: false });

    expect(analysis.rootPath).toBe(packageDir);
    expect(analysis.name).toBe('standalone');
    expect(analysis.notes).toContain(`- Root: ${packageDir}`);
  });

  test('addRepoToProject appends a repo entry with generated notes', async () => {
    const cloudRequest = jest.fn().mockResolvedValue({
      project: {
        id: 'project-1',
        slug: 'demo',
        name: 'Demo',
        repos: [
          { name: 'existing', path: '/tmp/existing', notes: 'Existing repo' },
          { name: 'web', path: '/tmp/new', notes: 'Auto-generated repo notes from local analysis.' },
        ],
      },
    });

    await addRepoToProject({
      project: {
        id: 'project-1',
        repos: [{ name: 'existing', path: '/tmp/existing', notes: 'Existing repo' }],
      },
      repoAnalysis: {
        name: 'web',
        rootPath: '/tmp/new',
        notes: 'Auto-generated repo notes from local analysis.',
      },
      cloudRequest,
    });

    expect(cloudRequest).toHaveBeenCalledWith('PATCH', '/api/projects/project-1', {
      repos: [
        { name: 'existing', path: '/tmp/existing', git_url: undefined, notes: 'Existing repo' },
        { name: 'web', path: '/tmp/new', notes: 'Auto-generated repo notes from local analysis.' },
      ],
    });
  });

  test('addRepoToProject rejects duplicate repo paths', async () => {
    await expect(addRepoToProject({
      project: {
        id: 'project-1',
        repos: [{ name: 'web', path: '/tmp/new' }],
      },
      repoAnalysis: {
        name: 'web',
        rootPath: '/tmp/new',
        notes: 'Generated notes',
      },
      cloudRequest: jest.fn(),
    })).rejects.toThrow('Project already contains repo at /tmp/new');
  });

  test('generateRepoNotesWithLlm uses configured default provider and model', async () => {
    const runAgxCommand = jest.fn().mockResolvedValue({
      stdout: 'Auto-generated repo notes from local analysis.\n\nSummary\n- Root: /tmp/repo',
      stderr: '',
      code: 0,
    });

    const result = await generateRepoNotesWithLlm({
      name: 'repo',
      rootPath: '/tmp/repo',
      packageManager: 'npm',
      languages: ['JavaScript'],
      frameworks: ['Jest'],
      keyFiles: ['package.json'],
      workspace: false,
      scripts: ['test'],
      readmeSummary: 'Test repo',
    }, {
      config: {
        defaultProvider: 'claude',
        models: { claude: 'claude-sonnet-4-5' },
      },
      runAgxCommand,
    });

    expect(result.provider).toBe('claude');
    expect(result.model).toBe('claude-sonnet-4-5');
    expect(runAgxCommand).toHaveBeenCalledWith(
      expect.arrayContaining(['claude', '-y', '-p', expect.any(String), '--model', 'claude-sonnet-4-5']),
      180000,
      'agx claude repo-analysis',
      { cwd: '/tmp/repo' }
    );
  });
});
