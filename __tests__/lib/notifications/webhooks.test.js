'use strict';

const originalFetch = global.fetch;

jest.mock('../../../lib/cli/configStore', () => ({
  loadConfig: jest.fn(),
}));

const { loadConfig } = require('../../../lib/cli/configStore');
const {
  normalizeWebhookEntry,
  parseWebhookEntries,
  eventMatches,
  sendWebhookEvent,
} = require('../../../lib/notifications/webhooks');

beforeEach(() => {
  loadConfig.mockReset();
  global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('webhook config normalization', () => {
  test('filters invalid entries and normalizes events', () => {
    loadConfig.mockReturnValue({
      webhooks: [
        { url: ' https://example.com/hook ', events: ['TASK.Stage_Complete', 'task.failed'] },
        { url: '', events: ['task.stage_complete'] },
        { url: 'https://wild.example.com', events: null },
      ],
    });

    const entries = parseWebhookEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      url: 'https://example.com/hook',
      events: ['task.stage_complete', 'task.failed'],
    });
    expect(entries[1]).toMatchObject({
      url: 'https://wild.example.com',
      events: ['*'],
    });
  });

  test('supports wildcard and prefix patterns', () => {
    const entry = normalizeWebhookEntry({ url: 'https://prefix', events: ['task.*'] });
    expect(entry.events).toContain('task.*');
    expect(eventMatches(entry, 'task.stage_complete')).toBe(true);
    expect(eventMatches(entry, 'task.failed')).toBe(true);
  });
});

describe('sendWebhookEvent', () => {
  test('posts only to matching endpoints', async () => {
    loadConfig.mockReturnValue({
      webhooks: [
        { url: 'https://all.example.com', events: ['*'] },
        { url: 'https://stage.example.com', events: ['task.stage_complete'] },
        { url: 'https://other.example.com', events: ['task.completed'] },
      ],
    });

    const matches = await sendWebhookEvent('task.stage_complete', { id: 'abc' }, { timestamp: '2026-02-13T00:00:00.000Z' });
    expect(matches.map((match) => match.url)).toEqual([
      'https://all.example.com',
      'https://stage.example.com',
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledWith('https://all.example.com', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'X-AGX-Event': 'task.stage_complete',
      }),
    }));

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      event: 'task.stage_complete',
      timestamp: '2026-02-13T00:00:00.000Z',
      payload: { id: 'abc' },
    });
  });

  test('logs and recovers from fetch failures', async () => {
    const logger = { error: jest.fn() };
    loadConfig.mockReturnValue({
      webhooks: [
        { url: 'https://fail.example.com', events: ['task.failed'] },
      ],
    });
    global.fetch = jest.fn().mockRejectedValue(new Error('boom'));

    const matches = await sendWebhookEvent('task.failed', null, { logger });
    expect(matches).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Webhook failed (https://fail.example.com)'));
  });
});
