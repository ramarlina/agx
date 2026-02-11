const { createHttpClient } = require('../../../lib/orchestrator/httpClient');

describe('orchestrator http client', () => {
  const config = {
    apiUrl: 'http://example.test',
    userId: 'user-1',
    token: 'token-1',
  };

  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(responseBody = { ok: true }) {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => responseBody,
    });
    global.fetch = fetchMock;
    return fetchMock;
  }

  test('queryTask defaults to GET /status with no body', async () => {
    const fetchMock = mockFetch({ status: 'queued' });
    const client = createHttpClient(config);

    const result = await client.queryTask('task-123');

    expect(result).toEqual({ status: 'queued' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://example.test/api/orchestrator/tasks/task-123/status');
    expect(options.method).toBe('GET');
    expect(options.body).toBeUndefined();
  });

  test('queryTask uses POST /status for custom query without args', async () => {
    const fetchMock = mockFetch({ status: 'ok' });
    const client = createHttpClient(config);

    await client.queryTask('task-123', 'getOutput');

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://example.test/api/orchestrator/tasks/task-123/status');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ query: 'getOutput' });
  });

  test('queryTask uses POST /status for advanced query with args', async () => {
    const fetchMock = mockFetch({ status: 'ok' });
    const client = createHttpClient(config);

    await client.queryTask('task-123', 'getStatus', { verbose: true });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://example.test/api/orchestrator/tasks/task-123/status');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ query: 'getStatus', args: { verbose: true } });
  });
});
