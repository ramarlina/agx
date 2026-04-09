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

describe('agx feedback CLI', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agx-feedback-cli-test-'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('submits feedback to the AGX feedback API with CLI context', async () => {
    const { runCli } = require('../../lib/cli/runCli');

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        item: {
          id: 'feedback-1',
          title: '[Feedback] CLI sync broke on startup',
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
      await runCli(buildCliArgs('feedback', 'CLI sync broke on startup'));

      if (exitCode !== 0) {
        throw new Error(`CLI exited with ${exitCode}. logs=${logs.join(' | ')} errors=${errors.join(' | ')}`);
      }

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://www.runagx.com/api/feedback/add');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      });

      const payload = JSON.parse(options.body);
      expect(payload.title).toBe('CLI sync broke on startup');
      expect(payload.description).toBe('CLI sync broke on startup');
      expect(payload.project).toBe('CLI');
      expect(payload.source).toBe('agx feedback');
      expect(payload.privateContext).toContain('agx version:');
      expect(payload.privateContext).toContain('Node.js:');
      expect(payload.privateContext).toContain('Platform:');
      expect(logs.join('\n')).toContain('Feedback saved to the AGX board');
      expect(errors.join('\n')).not.toContain('Unable to submit feedback');
    } finally {
      global.fetch = originalFetch;
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
