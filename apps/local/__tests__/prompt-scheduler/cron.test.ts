import { parseCadence, computeNextRun } from '@/src/prompt-scheduler/cron';

describe('parseCadence', () => {
  it('parses natural language to cron', () => {
    const result = parseCadence('daily at 9am');
    expect(result).not.toBeNull();
    expect(result!.cronExpr).toBe('0 9 * * *');
  });

  it('passes through valid cron expressions', () => {
    const result = parseCadence('*/15 * * * *');
    expect(result).not.toBeNull();
    expect(result!.cronExpr).toBe('*/15 * * * *');
  });

  it('parses "every 2 hours"', () => {
    const result = parseCadence('every 2 hours');
    expect(result).not.toBeNull();
    expect(result!.cronExpr).toBe('0 */2 * * *');
  });

  it('returns null for unparseable input', () => {
    expect(parseCadence('whenever the moon is full')).toBeNull();
  });
});

describe('computeNextRun', () => {
  it('returns a future timestamp for valid cron', () => {
    const next = computeNextRun('* * * * *');
    expect(next).toBeGreaterThan(Date.now());
  });

  it('returns null for invalid cron', () => {
    expect(computeNextRun('not a cron')).toBeNull();
  });
});
