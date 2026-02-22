'use strict';

const {
  classifyTaskExecutionTrack,
  buildV2RoutingError,
} = require('../../../lib/cli/v2TaskRouting');

describe('v2 task routing', () => {
  test('treats graph_id as v2', () => {
    const track = classifyTaskExecutionTrack({ id: 't1', graph_id: 'g1', stage: 'planning' });
    expect(track).toMatchObject({ track: 'v2', reason: 'graph_id_present' });
  });

  test('treats execution graph payload as v2', () => {
    const track = classifyTaskExecutionTrack({ id: 't2', execution_graph: { id: 'g2' } });
    expect(track).toMatchObject({ track: 'v2', reason: 'graph_payload_present' });
  });

  test('treats v2 board stages as v2', () => {
    const intake = classifyTaskExecutionTrack({ id: 't3', stage: 'INTAKE' });
    const progress = classifyTaskExecutionTrack({ id: 't4', stage: 'progress' });
    expect(intake).toMatchObject({ track: 'v2', reason: 'stage_intake' });
    expect(progress).toMatchObject({ track: 'v2', reason: 'stage_progress' });
  });

  test('treats graph mode SIMPLE/PROJECT as v2', () => {
    const simple = classifyTaskExecutionTrack({ id: 't5', graph_mode: 'SIMPLE' });
    const project = classifyTaskExecutionTrack({ id: 't6', mode: 'project' });
    expect(simple).toMatchObject({ track: 'v2', reason: 'graph_mode_simple' });
    expect(project).toMatchObject({ track: 'v2', reason: 'graph_mode_project' });
  });

  test('keeps legacy stage tasks on legacy track', () => {
    const track = classifyTaskExecutionTrack({ id: 't7', stage: 'planning' });
    expect(track).toMatchObject({ track: 'legacy', reason: 'stage_planning' });
  });

  test('includes route diagnostics in hard-fail error', () => {
    const task = { id: 'task-42', stage: 'INTAKE', graph_id: 'graph-42', mode: 'PROJECT' };
    const track = classifyTaskExecutionTrack(task);
    const message = buildV2RoutingError(task, track);

    expect(message).toContain('[v2-required]');
    expect(message).toContain('task-42');
    expect(message).toContain('graph-42');
    expect(message).toContain('reason=graph_id_present');
  });
});

