const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  maybeHandleWorkspaceCommand,
  canonicalizeWorkspaceCategory,
  inferProjectIdentifierFromCwd,
  formatWorkspaceLines,
  buildCreateBody,
} = require('../../lib/commands/workspace');

function makeColors() {
  return {
    bold: '',
    reset: '',
    red: '',
    green: '',
    yellow: '',
    dim: '',
  };
}

function exitWithCode(code) {
  const error = new Error(`process.exit:${code}`);
  error.exitCode = code;
  throw error;
}

describe('workspace command helpers', () => {
  let originalCwd;
  let tempDir;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agx-workspace-command-'));
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test('canonicalizes category aliases to stored workspace ids', () => {
    expect(canonicalizeWorkspaceCategory('repos')).toBe('repositories');
    expect(canonicalizeWorkspaceCategory('Repositories')).toBe('repositories');
    expect(canonicalizeWorkspaceCategory('Documentation')).toBe('docs');
    expect(canonicalizeWorkspaceCategory('CI Scripts')).toBe('ci-scripts');
  });

  test('infers the project slug from the enclosing git root', async () => {
    const repoRoot = path.join(tempDir, 'Mesh API');
    const nested = path.join(repoRoot, 'apps', 'local');
    await fs.promises.mkdir(path.join(repoRoot, '.git'), { recursive: true });
    await fs.promises.mkdir(nested, { recursive: true });

    expect(inferProjectIdentifierFromCwd(nested)).toBe('mesh-api');
  });

  test('formats grouped workspace output with empty default categories', () => {
    const output = formatWorkspaceLines(
      { name: 'Mesh' },
      {
        repositories: [
          { name: 'backend', path: '/code/backend', purpose: 'Backend API' },
        ],
        docs: [
          { name: 'specs', path: '/code/docs/specs', purpose: 'Architecture notes' },
        ],
      },
    ).join('\n');

    expect(output).toContain('Project: Mesh');
    expect(output).toContain('Repositories/');
    expect(output).toContain('backend    → /code/backend');
    expect(output).toContain('Backend API');
    expect(output).toContain('Docs/');
    expect(output).toContain('Config/\n  (empty)');
    expect(output).toContain('Scripts/\n  (empty)');
  });

  test('buildCreateBody omits empty optional fields', () => {
    expect(buildCreateBody('repositories', 'backend', '', '')).toEqual({
      category: 'repositories',
      name: 'backend',
    });
  });
});

describe('maybeHandleWorkspaceCommand', () => {
  let originalCwd;
  let tempDir;
  let exitSpy;
  let logSpy;
  let writeSpy;
  let originalFetch;
  let stdinTtyDescriptor;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agx-workspace-cli-'));
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => exitWithCode(code));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    originalFetch = global.fetch;
    stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    global.fetch = originalFetch;
    if (stdinTtyDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', stdinTtyDescriptor);
    } else {
      delete process.stdin.isTTY;
    }
    jest.restoreAllMocks();
  });

  test('add infers the project from cwd and canonicalizes category aliases', async () => {
    const repoRoot = path.join(tempDir, 'Mesh API');
    const nested = path.join(repoRoot, 'packages', 'cli');
    await fs.promises.mkdir(path.join(repoRoot, '.git'), { recursive: true });
    await fs.promises.mkdir(nested, { recursive: true });
    process.chdir(nested);

    const resolveProjectByIdentifier = jest.fn().mockResolvedValue({ id: 'project-1', name: 'Mesh' });
    const cloudRequest = jest.fn().mockResolvedValue({
      entry: { id: 'entry-1', category: 'repositories', name: 'backend', path: '/code/backend', purpose: null },
    });

    await expect(maybeHandleWorkspaceCommand({
      cmd: 'workspace',
      args: ['workspace', 'add', 'repos', 'backend', '/code/backend'],
      ctx: {
        c: makeColors(),
        cloudRequest,
        loadCloudConfigFile: () => ({ apiUrl: 'http://localhost:41741' }),
        resolveProjectByIdentifier,
        prompt: jest.fn(),
      },
    })).rejects.toMatchObject({ exitCode: 0 });

    expect(resolveProjectByIdentifier).toHaveBeenCalledWith('mesh-api');
    expect(cloudRequest).toHaveBeenCalledWith('POST', '/api/projects/project-1/workspace', {
      category: 'repositories',
      name: 'backend',
      path: '/code/backend',
    });
  });

  test('remove resolves an entry by category and name before deleting it', async () => {
    const resolveProjectByIdentifier = jest.fn().mockResolvedValue({ id: 'project-1', name: 'Mesh' });
    const cloudRequest = jest.fn()
      .mockResolvedValueOnce({
        workspace: {
          repositories: [
            { id: 'entry-1', name: 'backend', path: '/code/backend' },
          ],
        },
      })
      .mockResolvedValueOnce({ ok: true });

    await expect(maybeHandleWorkspaceCommand({
      cmd: 'workspace',
      args: ['workspace', 'remove', 'repos', 'backend', '--project', 'mesh', '--yes'],
      ctx: {
        c: makeColors(),
        cloudRequest,
        loadCloudConfigFile: () => ({ apiUrl: 'http://localhost:41741' }),
        resolveProjectByIdentifier,
        prompt: jest.fn(),
      },
    })).rejects.toMatchObject({ exitCode: 0 });

    expect(resolveProjectByIdentifier).toHaveBeenCalledWith('mesh');
    expect(cloudRequest).toHaveBeenNthCalledWith(1, 'GET', '/api/projects/project-1/workspace');
    expect(cloudRequest).toHaveBeenNthCalledWith(2, 'DELETE', '/api/projects/project-1/workspace/entry-1');
  });

  test('export writes YAML to stdout by default', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => 'version: 1\nentries: []\n',
    });

    await expect(maybeHandleWorkspaceCommand({
      cmd: 'workspace',
      args: ['workspace', 'export', '--project', 'mesh'],
      ctx: {
        c: makeColors(),
        cloudRequest: jest.fn(),
        loadCloudConfigFile: () => ({ apiUrl: 'http://example.test', userId: 'user-1', token: 'token-1' }),
        resolveProjectByIdentifier: jest.fn().mockResolvedValue({ id: 'project-1', name: 'Mesh' }),
        prompt: jest.fn(),
      },
    })).rejects.toMatchObject({ exitCode: 0 });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://example.test/api/projects/project-1/workspace/export',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-user-id': 'user-1',
          Authorization: 'Bearer token-1',
        }),
      }),
    );
    expect(writeSpy).toHaveBeenCalledWith('version: 1\nentries: []\n');
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Exported workspace'));
  });

  test('export writes YAML to a file when --output is provided', async () => {
    const outputPath = path.join(tempDir, '.agx', 'workspace.yaml');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => 'version: 1\nentries: []\n',
    });

    await expect(maybeHandleWorkspaceCommand({
      cmd: 'workspace',
      args: ['workspace', 'export', '--project', 'mesh', '--output', outputPath],
      ctx: {
        c: makeColors(),
        cloudRequest: jest.fn(),
        loadCloudConfigFile: () => ({ apiUrl: 'http://example.test', userId: 'user-1' }),
        resolveProjectByIdentifier: jest.fn().mockResolvedValue({ id: 'project-1', name: 'Mesh' }),
        prompt: jest.fn(),
      },
    })).rejects.toMatchObject({ exitCode: 0 });

    expect(fs.readFileSync(outputPath, 'utf8')).toBe('version: 1\nentries: []\n');
    expect(logSpy).toHaveBeenCalledWith(`✓ Exported workspace to ${outputPath}`);
    expect(writeSpy).not.toHaveBeenCalledWith('version: 1\nentries: []\n');
  });

  test('import reads YAML from a file and prints the returned summary', async () => {
    const importPath = path.join(tempDir, 'workspace.yaml');
    await fs.promises.writeFile(importPath, 'version: 1\nentries: []\n', 'utf8');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ summary: { created: 1, updated: 2, total: 3 } }),
    });

    await expect(maybeHandleWorkspaceCommand({
      cmd: 'workspace',
      args: ['workspace', 'import', importPath, '--project', 'mesh', '--yes'],
      ctx: {
        c: makeColors(),
        cloudRequest: jest.fn(),
        loadCloudConfigFile: () => ({ apiUrl: 'http://example.test', userId: 'user-1' }),
        resolveProjectByIdentifier: jest.fn().mockResolvedValue({ id: 'project-1', name: 'Mesh' }),
        prompt: jest.fn(),
      },
    })).rejects.toMatchObject({ exitCode: 0 });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://example.test/api/projects/project-1/workspace/import',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'text/yaml',
          'x-user-id': 'user-1',
        }),
        body: 'version: 1\nentries: []\n',
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(`✓ Imported workspace from ${importPath}`);
    expect(logSpy).toHaveBeenCalledWith('  Created: 1');
    expect(logSpy).toHaveBeenCalledWith('  Updated: 2');
    expect(logSpy).toHaveBeenCalledWith('  Total: 3');
  });

  test('import from piped stdin requires --yes in non-interactive mode', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: false,
    });
    global.fetch = jest.fn();

    await expect(maybeHandleWorkspaceCommand({
      cmd: 'workspace',
      args: ['workspace', 'import', '--project', 'mesh'],
      ctx: {
        c: makeColors(),
        cloudRequest: jest.fn(),
        loadCloudConfigFile: () => ({ apiUrl: 'http://example.test', userId: 'user-1' }),
        resolveProjectByIdentifier: jest.fn().mockResolvedValue({ id: 'project-1', name: 'Mesh' }),
        prompt: jest.fn(),
      },
    })).rejects.toMatchObject({ exitCode: 1 });

    expect(logSpy).toHaveBeenCalledWith('✗ Importing from stdin requires --yes in non-interactive mode.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('import accepts piped stdin when --yes is provided', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: false,
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ summary: { created: 0, updated: 1, total: 1 } }),
    });
    const originalReadFileSync = fs.readFileSync;
    jest.spyOn(fs, 'readFileSync').mockImplementation((target, encoding) => {
      if (target === 0 && encoding === 'utf8') return 'version: 1\nentries: []\n';
      return originalReadFileSync.call(fs, target, encoding);
    });

    await expect(maybeHandleWorkspaceCommand({
      cmd: 'workspace',
      args: ['workspace', 'import', '-', '--project', 'mesh', '--yes'],
      ctx: {
        c: makeColors(),
        cloudRequest: jest.fn(),
        loadCloudConfigFile: () => ({ apiUrl: 'http://example.test', userId: 'user-1' }),
        resolveProjectByIdentifier: jest.fn().mockResolvedValue({ id: 'project-1', name: 'Mesh' }),
        prompt: jest.fn(),
      },
    })).rejects.toMatchObject({ exitCode: 0 });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://example.test/api/projects/project-1/workspace/import',
      expect.objectContaining({
        body: 'version: 1\nentries: []\n',
      }),
    );
    expect(logSpy).toHaveBeenCalledWith('✓ Imported workspace from stdin');
  });

  test('import surfaces API error messages cleanly', async () => {
    const importPath = path.join(tempDir, 'workspace.yaml');
    await fs.promises.writeFile(importPath, 'version: 1\nentries: []\n', 'utf8');
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid workspace YAML' }),
    });

    await expect(maybeHandleWorkspaceCommand({
      cmd: 'workspace',
      args: ['workspace', 'import', importPath, '--project', 'mesh', '--yes'],
      ctx: {
        c: makeColors(),
        cloudRequest: jest.fn(),
        loadCloudConfigFile: () => ({ apiUrl: 'http://example.test', userId: 'user-1' }),
        resolveProjectByIdentifier: jest.fn().mockResolvedValue({ id: 'project-1', name: 'Mesh' }),
        prompt: jest.fn(),
      },
    })).rejects.toMatchObject({ exitCode: 1 });

    expect(logSpy).toHaveBeenCalledWith('✗ Import failed: Invalid workspace YAML');
  });
});
