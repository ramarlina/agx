import { cronToHuman } from '../../src/graph/nl-schedule';

describe('cronToHuman', () => {
  it('returns undefined for invalid cron (wrong field count)', () => {
    expect(cronToHuman('* * *')).toBeUndefined();
    expect(cronToHuman('* * * * * *')).toBeUndefined();
    expect(cronToHuman('')).toBeUndefined();
  });

  it('every minute', () => {
    expect(cronToHuman('* * * * *')).toBe('Every minute');
  });

  it('every N minutes', () => {
    expect(cronToHuman('*/5 * * * *')).toBe('Every 5 minutes');
    expect(cronToHuman('*/15 * * * *')).toBe('Every 15 minutes');
  });

  it('every hour', () => {
    expect(cronToHuman('0 * * * *')).toBe('Every hour');
    expect(cronToHuman('30 * * * *')).toBe('30 minutes past every hour');
  });

  it('every N hours', () => {
    expect(cronToHuman('0 */2 * * *')).toBe('Every 2 hours');
    expect(cronToHuman('0 */6 * * *')).toBe('Every 6 hours');
    expect(cronToHuman('15 */6 * * *')).toBe('15 minutes past every 6 hours');
  });

  it('daily at midnight', () => {
    expect(cronToHuman('0 0 * * *')).toBe('Daily at midnight');
  });

  it('daily at noon', () => {
    expect(cronToHuman('0 12 * * *')).toBe('Daily at noon');
  });

  it('daily at specific AM time', () => {
    expect(cronToHuman('0 9 * * *')).toBe('Daily at 9 AM');
    expect(cronToHuman('30 9 * * *')).toBe('Daily at 9:30 AM');
  });

  it('daily at specific PM time', () => {
    expect(cronToHuman('0 17 * * *')).toBe('Daily at 5 PM');
    expect(cronToHuman('45 13 * * *')).toBe('Daily at 1:45 PM');
  });

  it('weekdays at time', () => {
    expect(cronToHuman('0 9 * * 1-5')).toBe('Weekdays at 9 AM');
    expect(cronToHuman('30 14 * * 1-5')).toBe('Weekdays at 2:30 PM');
  });

  it('specific day of week', () => {
    expect(cronToHuman('0 9 * * 1')).toBe('Mondays at 9 AM');
    expect(cronToHuman('0 18 * * 5')).toBe('Fridays at 6 PM');
    expect(cronToHuman('0 10 * * 0')).toBe('Sundays at 10 AM');
  });

  it('every N days', () => {
    expect(cronToHuman('0 0 */3 * *')).toBe('Every 3 days');
  });

  it('returns undefined for unrecognized patterns', () => {
    expect(cronToHuman('0 0 1 * *')).toBeUndefined();       // monthly
    expect(cronToHuman('0 0 1 1 *')).toBeUndefined();       // yearly
    expect(cronToHuman('0 0 * * 1,3,5')).toBeUndefined();   // multiple days
  });

  it('trims whitespace', () => {
    expect(cronToHuman('  * * * * *  ')).toBe('Every minute');
  });
});
