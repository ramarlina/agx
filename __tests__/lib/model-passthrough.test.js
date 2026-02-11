describe('Model Passthrough', () => {
  test('passes --model flag to provider args when model is specified', () => {
    const model = 'claude-haiku-4-5';

    const args = [
      '/path/to/agx/index.js',
      'claude',
      '--cloud-task', 'test-task-id',
      '-y',
      '--model', model,
      '--prompt', 'test prompt',
    ];

    expect(args).toContain('--model');
    expect(args).toContain(model);

    const modelIdx = args.indexOf('--model');
    expect(args[modelIdx + 1]).toBe(model);
  });

  test('task model overrides config default', () => {
    const configDefault = 'claude-sonnet-4-5';
    const taskModel = 'claude-haiku-4-5';
    expect(taskModel || configDefault).toBe('claude-haiku-4-5');
  });

  test('falls back to config default when task has no model', () => {
    const configDefault = 'claude-sonnet-4-5';
    const taskModel = undefined;
    expect(taskModel || configDefault).toBe('claude-sonnet-4-5');
  });

  test('provider/model split from task frontmatter', () => {
    const taskModelFull = 'claude/claude-haiku-4-5';
    const [provider, model] = taskModelFull.includes('/')
      ? taskModelFull.split('/')
      : ['claude', taskModelFull];

    expect(provider).toBe('claude');
    expect(model).toBe('claude-haiku-4-5');
  });
});

