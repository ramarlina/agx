const {
  resolveStageObjective,
  buildStageRequirementPrompt,
  enforceStageRequirement,
  hasRequiredArtifact,
  STAGE_REQUIREMENTS
} = require('../../lib/stage-requirements');

describe('stage-requirements', () => {
  test('defines explicit ideation and planning requirements', () => {
    expect(STAGE_REQUIREMENTS.ideation.artifact).toBe('idea');
    expect(STAGE_REQUIREMENTS.planning.artifact).toBe('plan');
  });

  test('buildStageRequirementPrompt returns descriptive text for planning', () => {
    const text = buildStageRequirementPrompt({ stage: 'planning' });
    expect(text.toLowerCase()).toContain('plan');
    expect(text.toLowerCase()).toContain('only complete');
  });

  test('resolveStageObjective prefers task.stage_prompts over fallback', () => {
    const task = {
      stage_prompts: {
        planning: 'Write a numbered rollout plan and dependency matrix.'
      }
    };
    const resolved = resolveStageObjective(task, 'planning', 'fallback prompt');
    expect(resolved).toContain('dependency matrix');
  });

  test('hasRequiredArtifact accepts planning decisions that mention plan content', () => {
    const decision = {
      done: true,
      final_result: 'Execution plan: 1) set up schema 2) implement API 3) add tests.',
      summary: '',
      explanation: ''
    };
    expect(hasRequiredArtifact('planning', decision)).toBe(true);
  });

  test('hasRequiredArtifact uses stage prompt keywords for non-mapped stages', () => {
    const decision = {
      done: true,
      final_result: 'Ran regression tests and documented edge cases.',
      summary: '',
      explanation: ''
    };
    expect(hasRequiredArtifact('qa', decision, 'Run regression tests and document edge cases.')).toBe(true);
  });

  test('enforceStageRequirement converts done=true to not_done when planning artifact missing', () => {
    const decision = {
      done: true,
      decision: 'done',
      explanation: 'Looks complete.',
      final_result: 'Implemented most of it.',
      next_prompt: '',
      summary: ''
    };

    const normalized = enforceStageRequirement(decision, { stage: 'planning', stagePrompt: 'Create a detailed plan.' });

    expect(normalized.done).toBe(false);
    expect(normalized.decision).toBe('not_done');
    expect(normalized.explanation.toLowerCase()).toContain('requires a concrete plan');
    expect(normalized.next_prompt.toLowerCase()).toContain('produce a clear plan');
  });

  test('enforceStageRequirement leaves done decision unchanged for stages without requirement', () => {
    const decision = {
      done: true,
      decision: 'done',
      explanation: 'Completed coding.',
      final_result: 'Code implemented and tests passing.',
      next_prompt: '',
      summary: 'Done'
    };

    const normalized = enforceStageRequirement(decision, { stage: 'coding', stagePrompt: '' });
    expect(normalized).toEqual(decision);
  });

  test('enforceStageRequirement blocks done=true when stage objective from stage_prompts is not reflected', () => {
    const decision = {
      done: true,
      decision: 'done',
      explanation: 'Complete.',
      final_result: 'General progress update.',
      next_prompt: '',
      summary: ''
    };
    const normalized = enforceStageRequirement(decision, {
      stage: 'qa',
      stagePrompt: 'Run regression tests and document edge cases.'
    });
    expect(normalized.done).toBe(false);
    expect(normalized.decision).toBe('not_done');
    expect(normalized.explanation.toLowerCase()).toContain('completion must satisfy');
  });
});
