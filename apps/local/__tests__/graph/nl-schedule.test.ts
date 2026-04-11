import { cronToHuman, parseNaturalSchedule, toCronExpr } from '../../src/graph/nl-schedule';

describe('cronToHuman', () => {
  it('returns "Every minute" for * * * * *', () => {
    expect(cronToHuman('* * * * *')).toBe('Every minute');
  });

  it('handles every N minutes', () => {
    expect(cronToHuman('*/5 * * * *')).toBe('Every 5 minutes');
    expect(cronToHuman('*/15 * * * *')).toBe('Every 15 minutes');
  });

  it('handles every hour', () => {
    expect(cronToHuman('0 * * * *')).toBe('Every hour');
    expect(cronToHuman('30 * * * *')).toBe('30 minutes past every hour');
  });

  it('handles every N hours', () => {
    expect(cronToHuman('0 */2 * * *')).toBe('Every 2 hours');
    expect(cronToHuman('0 */6 * * *')).toBe('Every 6 hours');
    expect(cronToHuman('15 */6 * * *')).toBe('15 minutes past every 6 hours');
  });

  it('handles daily at midnight', () => {
    expect(cronToHuman('0 0 * * *')).toBe('Daily at midnight');
  });

  it('handles daily at noon', () => {
    expect(cronToHuman('0 12 * * *')).toBe('Daily at noon');
  });

  it('handles daily at specific AM time', () => {
    expect(cronToHuman('0 9 * * *')).toBe('Daily at 9 AM');
    expect(cronToHuman('30 9 * * *')).toBe('Daily at 9:30 AM');
  });

  it('handles daily at specific PM time', () => {
    expect(cronToHuman('0 15 * * *')).toBe('Daily at 3 PM');
    expect(cronToHuman('45 22 * * *')).toBe('Daily at 10:45 PM');
  });

  it('handles weekdays', () => {
    expect(cronToHuman('0 9 * * 1-5')).toBe('Weekdays at 9 AM');
    expect(cronToHuman('30 17 * * 1-5')).toBe('Weekdays at 5:30 PM');
  });

  it('handles specific day of week', () => {
    expect(cronToHuman('0 9 * * 1')).toBe('Mondays at 9 AM');
    expect(cronToHuman('0 14 * * 0')).toBe('Sundays at 2 PM');
    expect(cronToHuman('0 10 * * 6')).toBe('Saturdays at 10 AM');
  });

  it('handles every N days', () => {
    expect(cronToHuman('0 0 */3 * *')).toBe('Every 3 days');
  });

  it('returns undefined for unrecognized patterns', () => {
    expect(cronToHuman('0 9 1 * *')).toBeUndefined(); // monthly
    expect(cronToHuman('0 9 * 1 *')).toBeUndefined(); // specific month
    expect(cronToHuman('bad input')).toBeUndefined();
    expect(cronToHuman('0 9 1 6 *')).toBeUndefined();
  });

  it('returns undefined for wrong number of fields', () => {
    expect(cronToHuman('* * *')).toBeUndefined();
    expect(cronToHuman('* * * * * *')).toBeUndefined();
  });
});

describe('toCronExpr round-trip', () => {
  it('returns human-readable cadence for raw cron input', () => {
    const result = toCronExpr('0 9 * * *');
    expect(result.cronExpr).toBe('0 9 * * *');
    expect(result.cadence).toBe('Daily at 9 AM');
  });

  it('falls back to raw cron for unrecognized patterns', () => {
    const result = toCronExpr('0 9 1 * *');
    expect(result.cronExpr).toBe('0 9 1 * *');
    expect(result.cadence).toBe('0 9 1 * *');
  });
});
