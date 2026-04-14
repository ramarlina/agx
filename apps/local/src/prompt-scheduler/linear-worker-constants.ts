export const LINEAR_WORKER_JOB_NAME = 'Linear worker';
export const LINEAR_WORKER_DEFAULT_CADENCE = 'every 30 minutes';
export const LINEAR_WORKER_DEFAULT_PROMPT = [
  'Observe the full state of the Linear workspace — all teams, all issues, active sessions.',
  'Decide what single action most advances the workspace right now.',
  'If a specific ticket should be worked, choose work_ticket.',
  'If the workspace needs work not captured by an existing ticket, choose run_prompt with detailed instructions.',
  'If no action should be taken right now, choose stop.',
].join('\n');
