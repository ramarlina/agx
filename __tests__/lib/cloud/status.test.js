const { buildCloudTaskTerminalPatch } = require('../../../lib/cloud/status');

describe('buildCloudTaskTerminalPatch', () => {
  test('returns null for non-terminal decisions/stages', () => {
    expect(buildCloudTaskTerminalPatch({ decision: 'not_done', newStage: 'execution', nowIso: '2020-01-01T00:00:00.000Z' })).toBe(null);
  });

  test('marks completed when decision is done', () => {
    expect(buildCloudTaskTerminalPatch({ decision: 'done', newStage: 'execution', nowIso: '2020-01-01T00:00:00.000Z' }))
      .toEqual({ status: 'completed', completed_at: '2020-01-01T00:00:00.000Z' });
  });

  test('marks failed when decision is failed', () => {
    expect(buildCloudTaskTerminalPatch({ decision: 'failed', newStage: 'execution', nowIso: '2020-01-01T00:00:00.000Z' }))
      .toEqual({ status: 'failed', completed_at: '2020-01-01T00:00:00.000Z' });
  });

  test('marks blocked when decision is blocked', () => {
    expect(buildCloudTaskTerminalPatch({ decision: 'blocked', newStage: 'execution', nowIso: '2020-01-01T00:00:00.000Z' }))
      .toEqual({ status: 'blocked' });
  });

  test('marks completed when stage is done even if decision is not_done', () => {
    expect(buildCloudTaskTerminalPatch({ decision: 'not_done', newStage: 'done', nowIso: '2020-01-01T00:00:00.000Z' }))
      .toEqual({ status: 'completed', completed_at: '2020-01-01T00:00:00.000Z' });
  });
});

