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

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agx-workspace-cli-'));
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => exitWithCode(code));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.promises.rm(tempDir, { recursive: true, force: true });
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

  test('export is a recognized stub that exits with a not-implemented error', async () => {
    await expect(maybeHandleWorkspaceCommand({
      cmd: 'workspace',
      args: ['workspace', 'export'],
      ctx: {
        c: makeColors(),
        cloudRequest: jest.fn(),
        loadCloudConfigFile: () => ({ apiUrl: 'http://localhost:41741' }),
        resolveProjectByIdentifier: jest.fn(),
        prompt: jest.fn(),
      },
    })).rejects.toMatchObject({ exitCode: 1 });

    expect(logSpy).toHaveBeenCalledWith('Not yet implemented - see ESO-380');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
