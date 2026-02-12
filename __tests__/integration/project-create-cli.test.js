const path = require('path');
const os = require('os');
const fs = require('fs');

jest.mock('p-map', () => async (input, mapper) => Promise.all(Array.from(input).map(mapper)));
jest.mock('p-retry', () => {
  const retry = async (operation) => operation();
  retry.default = retry;
  return retry;
});

function buildCliArgs(...args) {
  return ['node', path.join(__dirname, '..', '..', 'index.js'), ...args];
}

describe('agx project create CLI', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agx-cli-test-'));
    process.env.AGX_CLOUD_URL = 'http://example.test';
    process.env.AGX_USER_ID = 'test-user';
  });

  test('creates a project via CLI and posts the payload', async () => {
    const { runCli } = require('../../lib/cli/runCli');

    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          project: {
            id: 'proj-123',
            name: 'My Project',
            slug: 'my-project',
            description: 'Agent work',
            repos: [{ name: 'api', path: '/code/api' }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          project: {
            id: 'proj-123',
            name: 'My Project',
            slug: 'my-project',
            description: 'Agent work',
            ci_cd_info: 'CI pipeline',
            metadata: { team: 'core' },
            repos: [{ name: 'api', path: '/code/api' }],
          },
        }),
      });

    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    let exitCode = null;
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      exitCode = typeof code === 'number' ? code : 0;
    });

    const logs = [];
    const errors = [];
    const logSpy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.join(' '));
    });

    try {
      const argv = buildCliArgs(
        'project',
        'create',
        '--name', 'My Project',
        '--slug', 'my-project',
        '--description', 'Agent work',
        '--ci', 'CI pipeline',
        '--metadata', 'team=core',
        '--repo', JSON.stringify({ name: 'api', path: '/code/api' }),
      );

      await runCli(argv);

      if (exitCode !== 0) {
        throw new Error(`CLI exited with ${exitCode}. logs=${logs.join(' | ')} errors=${errors.join(' | ')}`);
      }
      expect(exitCode).toBe(0);
      expect(logs.join('\n')).toContain('Project created: My Project (my-project)');
      expect(logs.join('\n')).toContain('ID: proj-123');
      expect(logs.join('\n')).toContain('Repos:');
      expect(logs.join('\n')).toContain('api');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [postUrl, postOptions] = fetchMock.mock.calls[0];
      expect(postUrl).toBe('http://example.test/api/projects');
      expect(postOptions.method).toBe('POST');
      expect(JSON.parse(postOptions.body)).toEqual({
        name: 'My Project',
        description: 'Agent work',
        repos: [{ name: 'api', path: '/code/api' }],
      });

      const [patchUrl, patchOptions] = fetchMock.mock.calls[1];
      expect(patchUrl).toBe('http://example.test/api/projects/proj-123');
      expect(patchOptions.method).toBe('PATCH');
      expect(JSON.parse(patchOptions.body)).toEqual({
        slug: 'my-project',
        ci_cd_info: 'CI pipeline',
        metadata: { team: 'core' },
      });
    } finally {
      global.fetch = originalFetch;
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
      process.env = { ...originalEnv };
    }
  });
});
