import type { ScheduleDraft } from '@/components/scheduling/ScheduleConditionPicker';

jest.mock('next/dynamic', () => () => () => null);
jest.mock('@/components/chat-ui/Markdown', () => ({ Markdown: () => null }));
jest.mock('@/hooks/usePromptJobs', () => ({ usePromptJobs: () => ({ jobs: [], loading: false }) }));
jest.mock('@/hooks/useGroupChat', () => ({ useGroupChat: () => ({ messages: [], setMessages: jest.fn(), sendMessage: jest.fn(), loadHistory: jest.fn(() => Promise.resolve()), chatRuns: [], stop: jest.fn() }) }));
jest.mock('@/hooks/useProcessPolling', () => ({ useProcessPolling: () => ({ processes: [], streaming: false, chatRuns: [] }) }));

const {
  buildScheduleCron,
  buildScheduleDescription,
  parseScheduleValue,
} = require('@/components/scheduling/ScheduleConditionPicker') as typeof import('@/components/scheduling/ScheduleConditionPicker');

function makeDraft(overrides: Partial<ScheduleDraft> = {}): ScheduleDraft {
  return {
    tab: 'daily',
    minuteInterval: 5,
    hourInterval: 1,
    minute: 0,
    hour: 9,
    selectedDays: [1, 2, 3, 4, 5],
    dayOfMonth: 1,
    customCron: '* * * * *',
    ...overrides,
  };
}

describe('PromptJobBoard schedule helpers', () => {
  it('builds minute interval cron expressions', () => {
    expect(buildScheduleCron(makeDraft({ tab: 'minutes', minuteInterval: 5 }))).toBe('*/5 * * * *');
    expect(buildScheduleDescription(makeDraft({ tab: 'minutes', minuteInterval: 5 }))).toBe('Every 5 minutes');
  });

  it('builds hourly interval cron expressions', () => {
    expect(buildScheduleCron(makeDraft({ tab: 'hourly', hourInterval: 4, minute: 0 }))).toBe('0 */4 * * *');
    expect(buildScheduleDescription(makeDraft({ tab: 'hourly', hourInterval: 4, minute: 0 }))).toBe('Every 4 hours at minute 00');
  });

  it('treats weekly schedules with no selected days as every day', () => {
    expect(buildScheduleCron(makeDraft({
      tab: 'weekly',
      hour: 8,
      minute: 15,
      selectedDays: [],
    }))).toBe('15 8 * * *');
    expect(buildScheduleDescription(makeDraft({
      tab: 'weekly',
      hour: 8,
      minute: 15,
      selectedDays: [],
    }))).toBe('Every day at 08:15');
  });

  it('hydrates known cron expressions into the matching schedule tabs', () => {
    expect(parseScheduleValue('*/10 * * * *')).toMatchObject({
      tab: 'minutes',
      minuteInterval: 10,
    });
    expect(parseScheduleValue('0 */4 * * *')).toMatchObject({
      tab: 'hourly',
      minute: 0,
      hourInterval: 4,
    });
    expect(parseScheduleValue('30 9 * * *')).toMatchObject({
      tab: 'daily',
      minute: 30,
      hour: 9,
    });
    expect(parseScheduleValue('15 8 * * 1,3,5')).toMatchObject({
      tab: 'weekly',
      minute: 15,
      hour: 8,
      selectedDays: [1, 3, 5],
    });
    expect(parseScheduleValue('45 6 12 * *')).toMatchObject({
      tab: 'monthly',
      minute: 45,
      hour: 6,
      dayOfMonth: 12,
    });
  });

  it('falls back to custom mode for unsupported cron expressions', () => {
    expect(parseScheduleValue('0 0 L * *')).toMatchObject({
      tab: 'custom',
      customCron: '0 0 L * *',
    });
  });
});
