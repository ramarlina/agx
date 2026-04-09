export const NOTIFICATION_EVENT_OPTIONS = [
  {
    value: 'task.created',
    label: 'Task created',
    description: 'Fires immediately when a new task is added to the queue.',
  },
  {
    value: 'task.stage_complete',
    label: 'Stage completed',
    description: 'Emitted whenever a stage finishes and the task advances.',
  },
  {
    value: 'task.completed',
    label: 'Task completed',
    description: 'When the task reaches a completed status (done).',
  },
  {
    value: 'task.failed',
    label: 'Task failed',
    description: 'When the task may have errored, including cancellations.',
  },
  {
    value: 'task.blocked',
    label: 'Task blocked',
    description: 'When the agent raises the task as blocked awaiting manual input.',
  },
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_OPTIONS)[number]['value'];
export const NOTIFICATION_EVENT_VALUES = NOTIFICATION_EVENT_OPTIONS.map((option) => option.value);
