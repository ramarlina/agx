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
  beforeEach(() => {
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agx-cli-test-'));
    process.env.AGX_CLOUD_URL = 'http://example.test';
    process.env.AGX_USER_ID = 'test-user';
  });

  test('creates a project via CLI and posts the payload', async () => {
    const { runCli } = require('../../lib/cli/runCli');

    const fetchMock = jest.fn().mockResolvedValue({
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

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('http://example.test/api/projects');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({
        name: 'My Project',
        slug: 'my-project',
        description: 'Agent work',
        ci_cd_info: 'CI pipeline',
        metadata: { team: 'core' },
        repos: [{ name: 'api', path: '/code/api' }],
      });
    } finally {
      global.fetch = originalFetch;
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
      process.env.HOME = undefined;
      process.env.AGX_CLOUD_URL = undefined;
      process.env.AGX_USER_ID = undefined;
    }
  });
});
