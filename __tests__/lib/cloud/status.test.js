const { buildCloudTaskTerminalPatch } = require('../../../lib/cloud/status');

describe('buildCloudTaskTerminalPatch', () => {
  test('returns null for non-terminal decisions/stages', () => {
    expect(buildCloudTaskTerminalPatch({ decision: 'not_done', newStage: 'execution', nowIso: '2020-01-01T00:00:00.000Z' })).toBe(null);
  });

  test('returns null when decision is done but stage is not done (stage machine handles transitions)', () => {
    expect(buildCloudTaskTerminalPatch({ decision: 'done', newStage: 'execution', nowIso: '2020-01-01T00:00:00.000Z' }))
      .toBe(null);
  });

  test('forces progress to done when decision is done', () => {
    expect(buildCloudTaskTerminalPatch({ decision: 'done', newStage: 'progress', nowIso: '2020-01-01T00:00:00.000Z' }))
      .toEqual({ stage: 'done', status: 'completed', completed_at: '2020-01-01T00:00:00.000Z' });
  });

  test('forces progress to done when new stage is missing but previous stage was progress', () => {
    expect(buildCloudTaskTerminalPatch({
      decision: 'done',
      newStage: null,
      previousStage: 'progress',
      nowIso: '2020-01-01T00:00:00.000Z',
    })).toEqual({ stage: 'done', status: 'completed', completed_at: '2020-01-01T00:00:00.000Z' });
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
