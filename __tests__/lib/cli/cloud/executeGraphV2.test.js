'use strict';

const fs = require('fs');
const path = require('path');
const { createCloudExecuteGraphV2 } = require('../../../../lib/cli/cloud/executeGraphV2');

function makeStorage() {
  const run = {
    run_id: 'run-1',
    stage: 'execute',
    paths: {
      root: '/tmp/agx/test-task/run-1/execute',
      plan: '/tmp/agx/test-task/run-1/plan',
      artifacts: '/tmp/agx/test-task/run-1/execute/artifacts',
    },
    finalized: false,
  };

  return {
    _run: run,
    createRun: jest.fn(async () => run),
    writeTaskGraph: jest.fn(async () => {}),
    finalizeRun: jest.fn(async (handle, decision) => {
      handle.finalized = true;
      handle._decision = decision;
    }),
  };
}

function makeArtifactsRecorder() {
  return {
    recordPrompt: jest.fn(),
    recordOutput: jest.fn(),
    flush: jest.fn(async () => {}),
  };
}

function makeCloudRequest(initialGraph) {
  let persisted = JSON.parse(JSON.stringify(initialGraph));
  const fn = jest.fn(async (method, endpoint, payload) => {
    if (method === 'GET' && endpoint.endsWith('/graph')) {
      return { graph: persisted };
    }

    if (method === 'PATCH' && endpoint.endsWith('/graph')) {
      const incoming = payload?.graph
        ? payload.graph
        : {
          ...persisted,
          mode: payload?.mode ?? persisted.mode,
          nodes: payload?.nodes ?? persisted.nodes,
          edges: payload?.edges ?? persisted.edges,
          policy: payload?.policy ?? persisted.policy,
          doneCriteria: payload?.doneCriteria ?? persisted.doneCriteria,
          status: payload?.status ?? persisted.status,
          startedAt: payload?.startedAt ?? persisted.startedAt,
          completedAt: payload?.completedAt ?? persisted.completedAt,
          timedOutAt: payload?.timedOutAt ?? persisted.timedOutAt,
          runtimeEvents: payload?.runtimeEvents ?? persisted.runtimeEvents,
        };
      persisted = {
        ...incoming,
        id: incoming.id || persisted.id,
        taskId: incoming.taskId || persisted.taskId,
        graphVersion: (persisted.graphVersion || 1) + 1,
      };
      return { graph: persisted };
    }

    throw new Error(`Unexpected cloud call: ${method} ${endpoint}`);
  });
  fn.getPersisted = () => JSON.parse(JSON.stringify(persisted));
  return fn;
}

function makeEnv(overrides = {}) {
  const artifacts = makeArtifactsRecorder();
  const env = {
    fs,
    path,
    logExecutionFlow: jest.fn(),
    abortIfCancelled: jest.fn(async () => {}),
    createDaemonArtifactsRecorder: jest.fn(() => artifacts),
    runSingleAgentIteration: jest.fn(async () => 'node-complete'),
    runSingleAgentPlanIteration: jest.fn(async () => 'node-complete'),
    buildLocalRunIndexEntry: jest.fn(async () => ({ run_id: 'run-1', status: 'done' })),
    finalizeRunSafe: jest.fn(async (storage, run, decision) => {
      if (run?.finalized) return;
      await storage.finalizeRun(run, decision);
    }),
    ...overrides,
  };
  env._artifacts = artifacts;
  return env;
}

describe('v2 graph execution loop', () => {
  beforeEach(() => {
    delete process.env.AGX_V2_GRAPH_LOAD_RETRIES;
  });

  afterEach(() => {
    delete process.env.AGX_V2_GRAPH_LOAD_RETRIES;
  });

  test('executes runnable work nodes and completes graph', async () => {
    const taskId = 'task-v2-1';
    const graph = {
      id: 'graph-1',
      taskId,
      graphVersion: 1,
      mode: 'PROJECT',
      nodes: {
        n1: { type: 'work', status: 'pending', deps: [], title: 'Implement change' },
      },
      edges: [],
      policy: { maxConcurrent: 1 },
      doneCriteria: { completionSinkNodeIds: ['n1'] },
    };

    const storage = makeStorage();
    const cloudRequest = makeCloudRequest(graph);
    const env = makeEnv();
    const { runV2GraphExecutionLoop } = createCloudExecuteGraphV2(env);

    const result = await runV2GraphExecutionLoop({
      taskId,
      task: { id: taskId, title: 'Add chat', execution_graph: graph },
      provider: 'gemini',
      model: null,
      logger: { log: jest.fn() },
      storage,
      projectSlug: 'agx',
      taskSlug: 'add-chat',
      stageLocal: 'execute',
      initialPromptContext: 'ctx',
      cancellationWatcher: null,
      cloudRequest,
    });

    expect(result.code).toBe(0);
    expect(result.decision.decision).toBe('done');
    expect(env.runSingleAgentIteration).toHaveBeenCalledTimes(1);
    expect(storage.writeTaskGraph).toHaveBeenCalled();
    expect(storage.finalizeRun).toHaveBeenCalled();
  });

  test('start node execution only runs the selected node', async () => {
    const taskId = 'task-v2-start-node-single';
    const graph = {
      id: 'graph-start-node-single',
      taskId,
      graphVersion: 1,
      mode: 'PROJECT',
      nodes: {
        n1: { type: 'work', status: 'pending', deps: [], title: 'First node' },
        n2: { type: 'work', status: 'pending', deps: [], title: 'Selected node' },
      },
      edges: [],
      policy: { maxConcurrent: 2 },
      doneCriteria: { completionSinkNodeIds: ['n1', 'n2'] },
    };

    const storage = makeStorage();
    const cloudRequest = makeCloudRequest(graph);
    const env = makeEnv();
    const { runV2GraphExecutionLoop } = createCloudExecuteGraphV2(env);

    const result = await runV2GraphExecutionLoop({
      taskId,
      task: {
        id: taskId,
        title: 'Only run selected node',
        start_node_id: 'n2',
        execution_graph: graph,
      },
      provider: 'gemini',
      model: null,
      logger: { log: jest.fn() },
      storage,
      projectSlug: 'agx',
      taskSlug: 'start-node-single',
      stageLocal: 'execute',
      initialPromptContext: '',
      cancellationWatcher: null,
      cloudRequest,
    });

    expect(result.code).toBe(0);
    expect(result.decision.decision).toBe('done');
    expect(env.runSingleAgentIteration).toHaveBeenCalledTimes(1);
    const prompt = env.runSingleAgentIteration.mock.calls[0][0]?.prompt || '';
    expect(prompt).toContain('Node ID: n2');

    const persisted = cloudRequest.getPersisted();
    expect(persisted.nodes.n2.status).toBe('done');
    expect(persisted.nodes.n1.status).toBe('pending');
  });

  test('re-running a worker start node resets downstream approval gates', async () => {
    const taskId = 'task-v2-start-node-rerun-reset';
    const graph = {
      id: 'graph-start-node-rerun-reset',
      taskId,
      graphVersion: 1,
      mode: 'PROJECT',
      nodes: {
        worker: {
          type: 'work',
          status: 'done',
          deps: [],
          title: 'Worker node',
          completedAt: '2026-02-16T10:00:00.000Z',
          output: { summary: 'old worker output' },
        },
        approval1: {
          type: 'gate',
          status: 'passed',
          deps: ['worker'],
          gateType: 'approval_gate',
          verificationStrategy: { type: 'human' },
          verificationResult: { passed: true, checks: [], verifiedAt: '2026-02-16T10:05:00.000Z', verifiedBy: 'human' },
          completedAt: '2026-02-16T10:05:00.000Z',
        },
        approval2: {
          type: 'gate',
          status: 'passed',
          deps: ['approval1'],
          gateType: 'approval_gate',
          verificationStrategy: { type: 'human' },
          verificationResult: { passed: true, checks: [], verifiedAt: '2026-02-16T10:10:00.000Z', verifiedBy: 'human' },
          completedAt: '2026-02-16T10:10:00.000Z',
        },
      },
      edges: [
        { from: 'worker', to: 'approval1', type: 'hard', condition: 'on_success' },
        { from: 'approval1', to: 'approval2', type: 'hard', condition: 'on_success' },
      ],
      policy: { maxConcurrent: 1 },
      doneCriteria: { completionSinkNodeIds: ['approval2'] },
    };

    const storage = makeStorage();
    const cloudRequest = makeCloudRequest(graph);
    const env = makeEnv();
    const { runV2GraphExecutionLoop } = createCloudExecuteGraphV2(env);

    const result = await runV2GraphExecutionLoop({
      taskId,
      task: {
        id: taskId,
        title: 'Rerun worker node',
        start_node_id: 'worker',
        execution_graph: graph,
      },
      provider: 'gemini',
      model: null,
      logger: { log: jest.fn() },
      storage,
      projectSlug: 'agx',
      taskSlug: 'start-node-rerun-reset',
      stageLocal: 'execute',
      initialPromptContext: '',
      cancellationWatcher: null,
      cloudRequest,
    });

    expect(result.code).toBe(0);
    expect(result.decision.decision).toBe('done');
    expect(env.runSingleAgentIteration).toHaveBeenCalledTimes(1);

    const persisted = cloudRequest.getPersisted();
    expect(persisted.nodes.worker.status).toBe('done');
    expect(persisted.nodes.approval1.status).toBe('pending');
    expect(persisted.nodes.approval1.verificationResult).toBeUndefined();
    expect(persisted.nodes.approval1.completedAt).toBeUndefined();
    expect(persisted.nodes.approval2.status).toBe('pending');
    expect(persisted.nodes.approval2.verificationResult).toBeUndefined();
    expect(persisted.nodes.approval2.completedAt).toBeUndefined();
  });

  test('uses planned work details in work-node execution prompt', async () => {
    const taskId = 'task-v2-work-prompt';
    const graph = {
      id: 'graph-work-prompt',
      taskId,
      graphVersion: 1,
      mode: 'PROJECT',
      nodes: {
        n1: {
          type: 'work',
          status: 'pending',
          deps: [],
          title: 'Implement global chat',
          description: 'Add global chat experience',
          workType: 'implementation',
          where: ['frontend: global chat panel', 'backend: chat endpoint'],
          whatChanges: ['Add panel state machine', 'Expose endpoint contract'],
          acceptanceCriteria: ['Chat panel available globally'],
          todos: ['Implement panel UI', 'Wire endpoint integration'],
          verification: ['Run chat flow smoke test'],
        },
      },
      edges: [],
      policy: { maxConcurrent: 1 },
      doneCriteria: { completionSinkNodeIds: ['n1'] },
    };

    const storage = makeStorage();
    const cloudRequest = makeCloudRequest(graph);
    const env = makeEnv();
    const { runV2GraphExecutionLoop } = createCloudExecuteGraphV2(env);

    const result = await runV2GraphExecutionLoop({
      taskId,
      task: {
        id: taskId,
        title: 'Add global chat',
        description: 'Implement a global chat launcher and panel experience.',
        content: 'legacy-content-should-not-win',
        execution_graph: graph,
      },
      provider: 'gemini',
      model: null,
      logger: { log: jest.fn() },
      storage,
      projectSlug: 'agx',
      taskSlug: 'global-chat-prompt',
      stageLocal: 'execute',
      initialPromptContext: '',
      cancellationWatcher: null,
      cloudRequest,
    });

    expect(result.code).toBe(0);
    expect(env.runSingleAgentIteration).toHaveBeenCalledTimes(1);
    const prompt = env.runSingleAgentIteration.mock.calls[0][0]?.prompt || '';
    expect(prompt).toContain('Task Objective: Implement a global chat launcher and panel experience.');
    expect(prompt).not.toContain('legacy-content-should-not-win');
    expect(prompt).toContain('Where (targets):');
    expect(prompt).toContain('frontend: global chat panel');
    expect(prompt).toContain('Planned Changes:');
    expect(prompt).toContain('Acceptance Criteria:');
    expect(prompt).toContain('To Dos:');
    expect(prompt).toContain('Validation Expectations:');
  });

  test('blocks when a gate requires human verification', async () => {
    const taskId = 'task-v2-2';
    const graph = {
      id: 'graph-2',
      taskId,
      graphVersion: 1,
      mode: 'PROJECT',
      nodes: {
        gate1: {
          type: 'gate',
          status: 'pending',
          deps: [],
          verificationStrategy: { type: 'human' },
        },
      },
      edges: [],
      policy: { maxConcurrent: 1 },
      doneCriteria: { completionSinkNodeIds: ['gate1'] },
    };

    const storage = makeStorage();
    const cloudRequest = makeCloudRequest(graph);
    const env = makeEnv();
    const { runV2GraphExecutionLoop } = createCloudExecuteGraphV2(env);

    const result = await runV2GraphExecutionLoop({
      taskId,
      task: { id: taskId, title: 'Gate task', execution_graph: graph },
      provider: 'gemini',
      model: null,
      logger: { log: jest.fn() },
      storage,
      projectSlug: 'agx',
      taskSlug: 'gate-task',
      stageLocal: 'execute',
      initialPromptContext: '',
      cancellationWatcher: null,
      cloudRequest,
    });

    expect(result.code).toBe(1);
    expect(result.decision.decision).toBe('blocked');
    expect(result.decision.explanation).toContain('requires human verification');
    expect(env.runSingleAgentIteration).not.toHaveBeenCalled();
  });

  test('auto-approves manual approval gates when task approval_mode is auto', async () => {
    const taskId = 'task-v2-auto-approve-gate';
    const graph = {
      id: 'graph-auto-approve-gate',
      taskId,
      graphVersion: 1,
      mode: 'PROJECT',
      nodes: {
        gate1: {
          type: 'gate',
          status: 'pending',
          gateType: 'approval_gate',
          deps: [],
          verificationStrategy: { type: 'human' },
        },
      },
      edges: [],
      policy: { maxConcurrent: 1 },
      doneCriteria: { completionSinkNodeIds: ['gate1'] },
    };

    const storage = makeStorage();
    const cloudRequest = makeCloudRequest(graph);
    const env = makeEnv();
    const { runV2GraphExecutionLoop } = createCloudExecuteGraphV2(env);

    const result = await runV2GraphExecutionLoop({
      taskId,
      task: {
        id: taskId,
        title: 'Auto approval mode',
        approval_mode: 'auto',
        execution_graph: graph,
      },
      provider: 'gemini',
      model: null,
      logger: { log: jest.fn() },
      storage,
      projectSlug: 'agx',
      taskSlug: 'auto-approve-gate',
      stageLocal: 'execute',
      initialPromptContext: '',
      cancellationWatcher: null,
      cloudRequest,
    });

    expect(result.code).toBe(0);
    expect(result.decision.decision).toBe('done');
    const persisted = cloudRequest.getPersisted();
    expect(persisted.nodes.gate1.status).toBe('passed');
    expect(persisted.nodes.gate1.verificationResult?.verifiedBy).toBe('auto_approval');
    expect(env.runSingleAgentIteration).not.toHaveBeenCalled();
  });

  test('reads auto approval mode from task frontmatter when structured field is absent', async () => {
    const taskId = 'task-v2-auto-approve-frontmatter';
    const graph = {
      id: 'graph-auto-approve-frontmatter',
      taskId,
      graphVersion: 1,
      mode: 'PROJECT',
      nodes: {
        gate1: {
          type: 'gate',
          status: 'pending',
          gateType: 'approval_gate',
          deps: [],
          verificationStrategy: { type: 'human' },
        },
      },
      edges: [],
      policy: { maxConcurrent: 1 },
      doneCriteria: { completionSinkNodeIds: ['gate1'] },
    };

    const storage = makeStorage();
    const cloudRequest = makeCloudRequest(graph);
    const env = makeEnv();
    const { runV2GraphExecutionLoop } = createCloudExecuteGraphV2(env);

    const result = await runV2GraphExecutionLoop({
      taskId,
      task: {
        id: taskId,
        title: 'Auto approval mode via frontmatter',
        content: '---\napproval_mode: auto\n---\n\n# Auto approve task\n',
        execution_graph: graph,
      },
      provider: 'gemini',
      model: null,
      logger: { log: jest.fn() },
      storage,
      projectSlug: 'agx',
      taskSlug: 'auto-approve-frontmatter',
      stageLocal: 'execute',
      initialPromptContext: '',
      cancellationWatcher: null,
      cloudRequest,
    });

    expect(result.code).toBe(0);
    expect(result.decision.decision).toBe('done');
    const persisted = cloudRequest.getPersisted();
    expect(persisted.nodes.gate1.status).toBe('passed');
  });

  test('normalizes mixed-case graph statuses and conditions so approved branches continue', async () => {
    const taskId = 'task-v2-mixed-case-approval';
    const graph = {
      id: 'graph-mixed-case-approval',
      taskId,
      graphVersion: 1,
      mode: 'PROJECT',
      nodes: {
        'plan-approval': {
          type: 'GATE',
          status: 'PASSED',
          gateType: 'APPROVAL_GATE',
          deps: [],
          verificationStrategy: { type: 'HUMAN' },
        },
        'next-work': {
          type: 'WORK',
          status: 'PENDING',
          deps: ['plan-approval'],
          title: 'Continue execution',
        },
      },
      edges: [
        { from: 'plan-approval', to: 'next-work', type: 'HARD', condition: 'ON_SUCCESS' },
      ],
      policy: { maxConcurrent: 1 },
      doneCriteria: { completionSinkNodeIds: ['next-work'] },
    };

    const storage = makeStorage();
    const cloudRequest = makeCloudRequest(graph);
    const env = makeEnv();
    const { runV2GraphExecutionLoop } = createCloudExecuteGraphV2(env);

    const result = await runV2GraphExecutionLoop({
      taskId,
      task: { id: taskId, title: 'Continue approved plan', execution_graph: graph },
      provider: 'gemini',
      model: null,
      logger: { log: jest.fn() },
      storage,
      projectSlug: 'agx',
      taskSlug: 'mixed-case-approval',
      stageLocal: 'execute',
      initialPromptContext: '',
      cancellationWatcher: null,
      cloudRequest,
    });

    expect(result.code).toBe(0);
    expect(result.decision.decision).toBe('done');
    expect(env.runSingleAgentIteration).toHaveBeenCalledTimes(1);
    const persisted = cloudRequest.getPersisted();
    expect(persisted.nodes['plan-approval'].status).toBe('passed');
    expect(persisted.nodes['next-work'].status).toBe('done');
    expect(persisted.edges[0].condition).toBe('on_success');
  });

  test('fails loudly when graph cannot be loaded from cloud', async () => {
    const taskId = 'task-v2-3';
    process.env.AGX_V2_GRAPH_LOAD_RETRIES = '1';
    const storage = makeStorage();
    const env = makeEnv();
    const { runV2GraphExecutionLoop } = createCloudExecuteGraphV2(env);
    const cloudRequest = jest.fn(async () => {
      throw new Error('not found');
    });

    await expect(
      runV2GraphExecutionLoop({
        taskId,
        task: { id: taskId, title: 'Missing graph', graph_id: 'graph-missing' },
        provider: 'gemini',
        model: null,
        logger: { log: jest.fn() },
        storage,
        projectSlug: 'agx',
        taskSlug: 'missing-graph',
        stageLocal: 'execute',
        initialPromptContext: '',
        cancellationWatcher: null,
        cloudRequest,
      })
    ).rejects.toThrow(`Failed to load graph for task ${taskId} via GET /api/tasks/${taskId}/graph after 1 attempt(s): not found`);
  });

  test('retries transient graph load failures and proceeds', async () => {
    const taskId = 'task-v2-4';
    process.env.AGX_V2_GRAPH_LOAD_RETRIES = '2';
    const graph = {
      id: 'graph-4',
      taskId,
      graphVersion: 1,
      mode: 'PROJECT',
      nodes: {
        n1: { type: 'work', status: 'pending', deps: [], title: 'Implement change' },
      },
      edges: [],
      policy: { maxConcurrent: 1 },
      doneCriteria: { completionSinkNodeIds: ['n1'] },
    };
    const storage = makeStorage();
    const env = makeEnv();
    const { runV2GraphExecutionLoop } = createCloudExecuteGraphV2(env);
    const baseCloudRequest = makeCloudRequest(graph);
    let graphGetAttempts = 0;
    const cloudRequest = jest.fn(async (method, endpoint, payload) => {
      if (method === 'GET' && endpoint.endsWith('/graph')) {
        graphGetAttempts += 1;
        if (graphGetAttempts === 1) {
          throw new Error('HTTP 500');
        }
      }
      return baseCloudRequest(method, endpoint, payload);
    });

    const result = await runV2GraphExecutionLoop({
      taskId,
      task: { id: taskId, title: 'Retry load graph', graph_id: 'graph-4' },
      provider: 'gemini',
      model: null,
      logger: { log: jest.fn() },
      storage,
      projectSlug: 'agx',
      taskSlug: 'retry-graph',
      stageLocal: 'execute',
      initialPromptContext: '',
      cancellationWatcher: null,
      cloudRequest,
    });

    expect(result.code).toBe(0);
    expect(result.decision.decision).toBe('done');
    expect(cloudRequest).toHaveBeenCalledWith('GET', `/api/tasks/${taskId}/graph`);
    expect(graphGetAttempts).toBe(2);
  });

  test('materializes plan output as draft graph gated by plan-approval', async () => {
    const taskId = 'task-v2-5';
    const graph = {
      id: 'graph-5',
      taskId,
      graphVersion: 1,
      mode: 'SIMPLE',
      nodes: {
        root: {
          type: 'root',
          status: 'pending',
          deps: [],
          title: 'Task root',
          objective: 'Add global chat interface',
          graphCreated: false,
          criteria: [],
        },
        plan: {
          type: 'work',
          status: 'pending',
          deps: ['root'],
          title: 'Generate execution plan',
          description: 'Generate plan',
          attempts: 0,
          maxAttempts: 2,
          retryPolicy: { backoffMs: 5000, onExhaust: 'escalate' },
        },
        'plan-approval': {
          type: 'gate',
          status: 'pending',
          gateType: 'approval_gate',
          required: true,
          deps: ['plan'],
          verificationStrategy: { type: 'human' },
        },
      },
      edges: [
        { from: 'root', to: 'plan', type: 'hard', condition: 'always' },
        { from: 'plan', to: 'plan-approval', type: 'hard', condition: 'always' },
      ],
      policy: { maxConcurrent: 1 },
      doneCriteria: { completionSinkNodeIds: ['plan-approval'] },
    };

    const plannedDraft = {
      nodes: {
        'read-codebase': {
          type: 'spike',
          title: 'Read codebase',
          description: 'Find CLI integration points',
          where: ['backend: lib/cli/chat/*', 'backend: lib/commands/chat.js'],
          whatChanges: ['Document integration boundaries for chat session orchestration', 'Identify command routing touchpoints for global chat invocation'],
          acceptanceCriteria: ['Identify integration boundaries for chat shell and state ownership'],
          todos: ['Inspect chat command and cloud execution entrypoints', 'Document integration points for UI and state wiring'],
          verification: ['Planner output references concrete integration locations'],
          deps: [],
        },
        'add-chat-ui': {
          type: 'work',
          title: 'Add chat UI',
          description: 'Define chat panel UI and UX states for global interaction',
          where: ['frontend: components/graph/*', 'frontend: app/projects/[slug]/tasks/[taskId]/page.tsx'],
          whatChanges: ['Define global chat panel and launcher UX', 'Specify loading/empty/error behavior and responsive states'],
          acceptanceCriteria: ['UI entry point exists on all relevant screens', 'Loading/empty/error states are defined'],
          todos: ['Design global chat panel structure', 'Specify message list and composer interactions'],
          verification: ['UI/UX plan includes accessibility and responsive behavior checks'],
          deps: ['read-codebase'],
        },
        'quality-gate': {
          type: 'gate',
          gateType: 'quality_gate',
          required: true,
          deps: ['add-chat-ui'],
        },
        'handoff-gate': {
          type: 'gate',
          gateType: 'handoff_gate',
          required: true,
          deps: ['quality-gate'],
          verificationStrategy: { type: 'human' },
        },
      },
      edges: [
        { from: 'read-codebase', to: 'add-chat-ui', type: 'hard' },
        { from: 'add-chat-ui', to: 'quality-gate', type: 'hard' },
        { from: 'quality-gate', to: 'handoff-gate', type: 'hard' },
      ],
    };

    const storage = makeStorage();
    const cloudRequest = makeCloudRequest(graph);
    const env = makeEnv({
      runSingleAgentPlanIteration: jest.fn(async () => JSON.stringify(plannedDraft)),
    });
    const { runV2GraphExecutionLoop } = createCloudExecuteGraphV2(env);

    const result = await runV2GraphExecutionLoop({
      taskId,
      task: { id: taskId, title: 'Add global chat', execution_graph: graph },
      provider: 'gemini',
      model: null,
      logger: { log: jest.fn() },
      storage,
      projectSlug: 'agx',
      taskSlug: 'global-chat',
      stageLocal: 'execute',
      initialPromptContext: '',
      cancellationWatcher: null,
      cloudRequest,
    });

    expect(result.code).toBe(1);
    expect(result.decision.decision).toBe('blocked');
    expect(result.decision.explanation).toContain('plan-approval');
    expect(env.runSingleAgentPlanIteration).toHaveBeenCalled();
    expect(env.runSingleAgentIteration).not.toHaveBeenCalled();

    const persisted = cloudRequest.getPersisted();
    expect(persisted.nodes['read-codebase']).toBeTruthy();
    expect(persisted.nodes['read-codebase'].type).toBe('work');
    expect(persisted.nodes['read-codebase'].workType).toBe('spike');
    expect(persisted.nodes['add-chat-ui']).toBeTruthy();
    expect(persisted.nodes['handoff-gate']).toBeTruthy();
    expect(persisted.nodes['read-codebase'].deps).toContain('plan-approval');
    expect(
      persisted.edges.some((edge) => edge.from === 'plan-approval'
        && edge.to === 'read-codebase'
        && edge.condition === 'on_success')
    ).toBe(true);
    expect(persisted.doneCriteria.completionSinkNodeIds).toContain('handoff-gate');
  });

  test('retries planner when draft lacks required work details', async () => {
    const taskId = 'task-v2-6';
    const graph = {
      id: 'graph-6',
      taskId,
      graphVersion: 1,
      mode: 'SIMPLE',
      nodes: {
        root: { type: 'root', status: 'pending', deps: [], title: 'Task root', objective: 'Global chat UX', graphCreated: false, criteria: [] },
        plan: {
          type: 'work',
          status: 'pending',
          deps: ['root'],
          title: 'Generate execution plan',
          description: 'Generate plan',
          attempts: 0,
          maxAttempts: 2,
          retryPolicy: { backoffMs: 5000, onExhaust: 'escalate' },
        },
        'plan-approval': {
          type: 'gate',
          status: 'pending',
          gateType: 'approval_gate',
          required: true,
          deps: ['plan'],
          verificationStrategy: { type: 'human' },
        },
      },
      edges: [
        { from: 'root', to: 'plan', type: 'hard', condition: 'always' },
        { from: 'plan', to: 'plan-approval', type: 'hard', condition: 'always' },
      ],
      policy: { maxConcurrent: 1 },
      doneCriteria: { completionSinkNodeIds: ['plan-approval'] },
    };

    const weakDraft = {
      nodes: {
        'add-chat': {
          type: 'work',
          title: 'Add chat',
          description: 'Do chat work',
          deps: [],
        },
      },
      edges: [],
    };
    const strongDraft = {
      nodes: {
        'design-chat-ui': {
          type: 'work',
          title: 'Design chat UI',
          description: 'Define global chat interface structure and behaviors',
          where: ['frontend: global chat panel', 'frontend: navigation launcher'],
          whatChanges: ['Add UI structure for launcher/panel', 'Define UX behavior for loading, error, and keyboard navigation'],
          acceptanceCriteria: ['Global launcher and panel entry are defined', 'Composer and message list UX behaviors are specified'],
          todos: ['Define panel layout and interaction model', 'Document loading, empty, and error states'],
          verification: ['UI checklist includes accessibility and responsive constraints'],
          deps: [],
        },
        'quality-gate': {
          type: 'gate',
          gateType: 'quality_gate',
          required: true,
          deps: ['design-chat-ui'],
        },
        'handoff-gate': {
          type: 'gate',
          gateType: 'handoff_gate',
          required: true,
          deps: ['quality-gate'],
          verificationStrategy: { type: 'human' },
        },
      },
      edges: [
        { from: 'design-chat-ui', to: 'quality-gate', type: 'hard' },
        { from: 'quality-gate', to: 'handoff-gate', type: 'hard' },
      ],
    };

    const planner = jest.fn()
      .mockResolvedValueOnce(JSON.stringify(weakDraft))
      .mockResolvedValueOnce(JSON.stringify(strongDraft));
    const storage = makeStorage();
    const cloudRequest = makeCloudRequest(graph);
    const env = makeEnv({ runSingleAgentPlanIteration: planner });
    const { runV2GraphExecutionLoop } = createCloudExecuteGraphV2(env);

    const result = await runV2GraphExecutionLoop({
      taskId,
      task: { id: taskId, title: 'Add global chat interface with good UX', execution_graph: graph },
      provider: 'gemini',
      model: null,
      logger: { log: jest.fn() },
      storage,
      projectSlug: 'agx',
      taskSlug: 'global-chat-ux',
      stageLocal: 'execute',
      initialPromptContext: '',
      cancellationWatcher: null,
      cloudRequest,
    });

    expect(result.code).toBe(1);
    expect(result.decision.decision).toBe('blocked');
    expect(planner).toHaveBeenCalledTimes(2);
    const persisted = cloudRequest.getPersisted();
    expect(persisted.nodes['design-chat-ui']).toBeTruthy();
    expect(persisted.nodes['design-chat-ui'].acceptanceCriteria.length).toBeGreaterThan(0);
    expect(persisted.doneCriteria.completionSinkNodeIds).toContain('handoff-gate');
  });

  test('re-running plan replaces previous draft nodes instead of appending', async () => {
    const taskId = 'task-v2-7';
    const graph = {
      id: 'graph-7',
      taskId,
      graphVersion: 1,
      mode: 'SIMPLE',
      nodes: {
        root: { type: 'root', status: 'done', deps: [], title: 'Task root', objective: 'Global chat', graphCreated: true, criteria: [] },
        plan: {
          type: 'work',
          status: 'pending',
          deps: ['root'],
          title: 'Generate execution plan',
          description: 'Generate plan',
          attempts: 0,
          maxAttempts: 2,
          retryPolicy: { backoffMs: 5000, onExhaust: 'escalate' },
          output: {
            draftNodeIds: ['old-ui-node', 'old-quality-gate', 'old-handoff-gate'],
            draftSinkNodeIds: ['old-handoff-gate'],
          },
        },
        'plan-approval': {
          type: 'gate',
          status: 'pending',
          gateType: 'approval_gate',
          required: true,
          deps: ['plan'],
          verificationStrategy: { type: 'human' },
        },
        'old-ui-node': {
          type: 'work',
          status: 'pending',
          title: 'Old UI node',
          description: 'Old plan output',
          deps: ['plan-approval'],
          generatedByPlanNodeId: 'plan',
          acceptanceCriteria: ['Old criterion'],
          todos: ['Old todo'],
          verification: ['Old verification'],
          attempts: 0,
          maxAttempts: 2,
          retryPolicy: { backoffMs: 5000, onExhaust: 'escalate' },
          estimateMinutes: 15,
        },
        'old-quality-gate': {
          type: 'gate',
          status: 'pending',
          gateType: 'quality_gate',
          required: true,
          deps: ['old-ui-node'],
          generatedByPlanNodeId: 'plan',
        },
        'old-handoff-gate': {
          type: 'gate',
          status: 'pending',
          gateType: 'handoff_gate',
          required: true,
          deps: ['old-quality-gate'],
          verificationStrategy: { type: 'human' },
          generatedByPlanNodeId: 'plan',
        },
      },
      edges: [
        { from: 'root', to: 'plan', type: 'hard', condition: 'always' },
        { from: 'plan', to: 'plan-approval', type: 'hard', condition: 'always' },
        { from: 'plan-approval', to: 'old-ui-node', type: 'hard', condition: 'on_success' },
        { from: 'old-ui-node', to: 'old-quality-gate', type: 'hard', condition: 'on_success' },
        { from: 'old-quality-gate', to: 'old-handoff-gate', type: 'hard', condition: 'on_success' },
      ],
      policy: { maxConcurrent: 1 },
      doneCriteria: { completionSinkNodeIds: ['old-handoff-gate'] },
    };

    const replacementDraft = {
      nodes: {
        'new-ui-node': {
          type: 'work',
          title: 'New UI node',
          description: 'Replacement UI and UX plan output for chat states and interactions',
          where: ['frontend: chat panel', 'backend: chat orchestration service', 'database: chat session persistence'],
          whatChanges: ['Define component and state flow for global chat', 'Specify backend API/session changes', 'Identify schema touchpoints for session/message persistence'],
          acceptanceCriteria: [
            'UI component structure is defined for global chat entry and panel',
            'UX states include loading, empty, and error handling',
          ],
          todos: [
            'Define chat layout and component hierarchy',
            'Document accessibility and responsive behavior expectations',
          ],
          verification: [
            'Validate UX flow coverage for loading, error, and keyboard access',
          ],
          deps: [],
        },
        'quality-gate': {
          type: 'gate',
          gateType: 'quality_gate',
          required: true,
          deps: ['new-ui-node'],
        },
        'handoff-gate': {
          type: 'gate',
          gateType: 'handoff_gate',
          required: true,
          deps: ['quality-gate'],
          verificationStrategy: { type: 'human' },
        },
      },
      edges: [
        { from: 'new-ui-node', to: 'quality-gate', type: 'hard' },
        { from: 'quality-gate', to: 'handoff-gate', type: 'hard' },
      ],
    };

    const storage = makeStorage();
    const cloudRequest = makeCloudRequest(graph);
    const env = makeEnv({
      runSingleAgentPlanIteration: jest.fn(async () => JSON.stringify(replacementDraft)),
    });
    const { runV2GraphExecutionLoop } = createCloudExecuteGraphV2(env);

    const result = await runV2GraphExecutionLoop({
      taskId,
      task: { id: taskId, title: 'Replan global chat', execution_graph: graph },
      provider: 'gemini',
      model: null,
      logger: { log: jest.fn() },
      storage,
      projectSlug: 'agx',
      taskSlug: 'replan-global-chat',
      stageLocal: 'execute',
      initialPromptContext: '',
      cancellationWatcher: null,
      cloudRequest,
    });

    expect(result.code).toBe(1);
    expect(result.decision.decision).toBe('blocked');
    const persisted = cloudRequest.getPersisted();
    expect(persisted.nodes['old-ui-node']).toBeUndefined();
    expect(persisted.nodes['old-quality-gate']).toBeUndefined();
    expect(persisted.nodes['old-handoff-gate']).toBeUndefined();
    expect(persisted.nodes['new-ui-node']).toBeTruthy();
    expect(persisted.nodes['new-ui-node'].generatedByPlanNodeId).toBe('plan');
    expect(persisted.doneCriteria.completionSinkNodeIds).toContain('handoff-gate');
    expect(persisted.doneCriteria.completionSinkNodeIds).not.toContain('old-handoff-gate');
  });

  test('re-running completed plan fully replaces even previously done plan nodes', async () => {
    const taskId = 'task-v2-rerun-done-replace';
    const graph = {
      id: 'graph-rerun-done-replace',
      taskId,
      graphVersion: 1,
      mode: 'SIMPLE',
      nodes: {
        root: { type: 'root', status: 'done', deps: [], title: 'Task root', objective: 'Global chat', graphCreated: true, criteria: [] },
        plan: {
          type: 'work',
          status: 'pending',
          completedAt: '2026-02-16T14:37:49.961Z',
          deps: ['root'],
          title: 'Generate execution plan',
          description: 'Generate plan',
          attempts: 0,
          maxAttempts: 2,
          retryPolicy: { backoffMs: 5000, onExhaust: 'escalate' },
          output: {
            proposedGraph: { nodes: {}, edges: [] },
            draftNodeIds: ['old-done-node', 'old-quality-gate', 'old-handoff-gate'],
            draftSinkNodeIds: ['old-handoff-gate'],
          },
        },
        'plan-approval': {
          type: 'gate',
          status: 'pending',
          gateType: 'approval_gate',
          required: true,
          deps: ['plan'],
          verificationStrategy: { type: 'human' },
        },
        'old-done-node': {
          type: 'work',
          status: 'done',
          title: 'Old done node',
          description: 'Old plan output',
          deps: ['plan-approval'],
          generatedByPlanNodeId: 'plan',
          acceptanceCriteria: ['Old criterion'],
          todos: ['Old todo'],
          verification: ['Old verification'],
          attempts: 0,
          maxAttempts: 2,
          retryPolicy: { backoffMs: 5000, onExhaust: 'escalate' },
          estimateMinutes: 15,
          output: { summary: 'completed old work' },
        },
        'old-quality-gate': {
          type: 'gate',
          status: 'passed',
          gateType: 'quality_gate',
          required: true,
          deps: ['old-done-node'],
          generatedByPlanNodeId: 'plan',
        },
        'old-handoff-gate': {
          type: 'gate',
          status: 'skipped',
          gateType: 'handoff_gate',
          required: true,
          deps: ['old-quality-gate'],
          verificationStrategy: { type: 'human' },
          generatedByPlanNodeId: 'plan',
        },
      },
      edges: [
        { from: 'root', to: 'plan', type: 'hard', condition: 'always' },
        { from: 'plan', to: 'plan-approval', type: 'hard', condition: 'always' },
        { from: 'plan-approval', to: 'old-done-node', type: 'hard', condition: 'on_success' },
        { from: 'old-done-node', to: 'old-quality-gate', type: 'hard', condition: 'on_success' },
        { from: 'old-quality-gate', to: 'old-handoff-gate', type: 'hard', condition: 'on_success' },
      ],
      policy: { maxConcurrent: 1 },
      doneCriteria: { completionSinkNodeIds: ['old-handoff-gate'] },
    };

    const replacementDraft = {
      nodes: {
        'new-node': {
          type: 'work',
          title: 'New node',
          description: 'Replacement branch',
          where: ['frontend: global chat panel'],
          whatChanges: ['Replace previously completed branch for rerun'],
          acceptanceCriteria: ['Only new branch remains'],
          todos: ['Implement replacement branch'],
          verification: ['No old completed plan nodes remain in graph'],
          deps: [],
        },
        'quality-gate': {
          type: 'gate',
          gateType: 'quality_gate',
          required: true,
          deps: ['new-node'],
        },
        'handoff-gate': {
          type: 'gate',
          gateType: 'handoff_gate',
          required: true,
          deps: ['quality-gate'],
          verificationStrategy: { type: 'human' },
        },
      },
      edges: [
        { from: 'new-node', to: 'quality-gate', type: 'hard' },
        { from: 'quality-gate', to: 'handoff-gate', type: 'hard' },
      ],
    };

    const storage = makeStorage();
    const cloudRequest = makeCloudRequest(graph);
    const env = makeEnv({
      runSingleAgentPlanIteration: jest.fn(async () => JSON.stringify(replacementDraft)),
    });
    const { runV2GraphExecutionLoop } = createCloudExecuteGraphV2(env);

    const result = await runV2GraphExecutionLoop({
      taskId,
      task: { id: taskId, title: 'Rerun completed plan', execution_graph: graph },
      provider: 'gemini',
      model: null,
      logger: { log: jest.fn() },
      storage,
      projectSlug: 'agx',
      taskSlug: 'rerun-done-replace',
      stageLocal: 'execute',
      initialPromptContext: '',
      cancellationWatcher: null,
      cloudRequest,
    });

    expect(result.code).toBe(1);
    expect(result.decision.decision).toBe('blocked');
    expect(env.runSingleAgentPlanIteration).toHaveBeenCalledTimes(1);
    const rerunPrompt = env.runSingleAgentPlanIteration.mock.calls[0][0]?.prompt || '';
    expect(rerunPrompt).not.toContain('You are RE-PLANNING an existing graph');
    expect(rerunPrompt).not.toContain('Current plan snapshot (node id, type, status, deps, title):');
    const persisted = cloudRequest.getPersisted();
    expect(persisted.nodes['old-done-node']).toBeUndefined();
    expect(persisted.nodes['old-quality-gate']).toBeUndefined();
    expect(persisted.nodes['old-handoff-gate']).toBeUndefined();
    expect(persisted.nodes['new-node']).toBeTruthy();
  });

  test('re-running plan removes legacy downstream branches even without plan metadata', async () => {
    const taskId = 'task-v2-legacy-branch';
    const graph = {
      id: 'graph-legacy-branch',
      taskId,
      graphVersion: 1,
      mode: 'SIMPLE',
      nodes: {
        root: { type: 'root', status: 'done', deps: [], title: 'Task root', objective: 'Global chat', graphCreated: true, criteria: [] },
        plan: {
          type: 'work',
          status: 'pending',
          deps: ['root'],
          title: 'Generate execution plan',
          description: 'Generate plan',
          attempts: 0,
          maxAttempts: 2,
          retryPolicy: { backoffMs: 5000, onExhaust: 'escalate' },
          output: {
            draftNodeIds: ['known-node', 'known-quality', 'known-handoff'],
            draftSinkNodeIds: ['known-handoff'],
          },
        },
        'plan-approval': {
          type: 'gate',
          status: 'pending',
          gateType: 'approval_gate',
          required: true,
          deps: ['plan'],
          verificationStrategy: { type: 'human' },
        },
        'known-node': {
          type: 'work',
          status: 'pending',
          title: 'Known branch node',
          description: 'Known plan output',
          deps: ['plan-approval'],
          generatedByPlanNodeId: 'plan',
          acceptanceCriteria: ['Known criterion'],
          todos: ['Known todo'],
          verification: ['Known verification'],
          attempts: 0,
          maxAttempts: 2,
          retryPolicy: { backoffMs: 5000, onExhaust: 'escalate' },
          estimateMinutes: 15,
        },
        'known-quality': {
          type: 'gate',
          status: 'pending',
          gateType: 'quality_gate',
          required: true,
          deps: ['known-node'],
          generatedByPlanNodeId: 'plan',
        },
        'known-handoff': {
          type: 'gate',
          status: 'pending',
          gateType: 'handoff_gate',
          required: true,
          deps: ['known-quality'],
          verificationStrategy: { type: 'human' },
          generatedByPlanNodeId: 'plan',
        },
        // Legacy branch: downstream of plan-approval but missing generatedByPlanNodeId
        'legacy-node': {
          type: 'work',
          status: 'pending',
          title: 'Legacy branch node',
          description: 'Old branch without metadata',
          deps: ['plan-approval'],
          acceptanceCriteria: ['Legacy criterion'],
          todos: ['Legacy todo'],
          verification: ['Legacy verification'],
          attempts: 0,
          maxAttempts: 2,
          retryPolicy: { backoffMs: 5000, onExhaust: 'escalate' },
          estimateMinutes: 15,
        },
        'legacy-quality': {
          type: 'gate',
          status: 'pending',
          gateType: 'quality_gate',
          required: true,
          deps: ['legacy-node'],
        },
        'legacy-handoff': {
          type: 'gate',
          status: 'pending',
          gateType: 'handoff_gate',
          required: true,
          deps: ['legacy-quality'],
          verificationStrategy: { type: 'human' },
        },
      },
      edges: [
        { from: 'root', to: 'plan', type: 'hard', condition: 'always' },
        { from: 'plan', to: 'plan-approval', type: 'hard', condition: 'always' },
        { from: 'plan-approval', to: 'known-node', type: 'hard', condition: 'on_success' },
        { from: 'known-node', to: 'known-quality', type: 'hard', condition: 'on_success' },
        { from: 'known-quality', to: 'known-handoff', type: 'hard', condition: 'on_success' },
        { from: 'plan-approval', to: 'legacy-node', type: 'hard', condition: 'on_success' },
        { from: 'legacy-node', to: 'legacy-quality', type: 'hard', condition: 'on_success' },
        { from: 'legacy-quality', to: 'legacy-handoff', type: 'hard', condition: 'on_success' },
      ],
      policy: { maxConcurrent: 1 },
      doneCriteria: { completionSinkNodeIds: ['known-handoff', 'legacy-handoff'] },
    };

    const replacementDraft = {
      nodes: {
        'new-node': {
          type: 'work',
          title: 'New node',
          description: 'Replacement branch',
          where: ['frontend: global chat panel'],
          whatChanges: ['Define new replacement plan branch'],
          acceptanceCriteria: ['New branch is the only downstream plan'],
          todos: ['Implement replacement branch'],
          verification: ['Confirm no duplicate tails remain'],
          deps: [],
        },
        'quality-gate': {
          type: 'gate',
          gateType: 'quality_gate',
          required: true,
          deps: ['new-node'],
        },
        'handoff-gate': {
          type: 'gate',
          gateType: 'handoff_gate',
          required: true,
          deps: ['quality-gate'],
          verificationStrategy: { type: 'human' },
        },
      },
      edges: [
        { from: 'new-node', to: 'quality-gate', type: 'hard' },
        { from: 'quality-gate', to: 'handoff-gate', type: 'hard' },
      ],
    };

    const storage = makeStorage();
    const cloudRequest = makeCloudRequest(graph);
    const env = makeEnv({
      runSingleAgentPlanIteration: jest.fn(async () => JSON.stringify(replacementDraft)),
    });
    const { runV2GraphExecutionLoop } = createCloudExecuteGraphV2(env);

    const result = await runV2GraphExecutionLoop({
      taskId,
      task: { id: taskId, title: 'Replan with legacy branch cleanup', execution_graph: graph },
      provider: 'gemini',
      model: null,
      logger: { log: jest.fn() },
      storage,
      projectSlug: 'agx',
      taskSlug: 'legacy-branch-cleanup',
      stageLocal: 'execute',
      initialPromptContext: '',
      cancellationWatcher: null,
      cloudRequest,
    });

    expect(result.code).toBe(1);
    expect(result.decision.decision).toBe('blocked');
    const persisted = cloudRequest.getPersisted();
    expect(persisted.nodes['known-node']).toBeUndefined();
    expect(persisted.nodes['known-quality']).toBeUndefined();
    expect(persisted.nodes['known-handoff']).toBeUndefined();
    expect(persisted.nodes['legacy-node']).toBeUndefined();
    expect(persisted.nodes['legacy-quality']).toBeUndefined();
    expect(persisted.nodes['legacy-handoff']).toBeUndefined();
    expect(persisted.nodes['new-node']).toBeTruthy();
    expect(persisted.doneCriteria.completionSinkNodeIds).toContain('handoff-gate');
    expect(persisted.doneCriteria.completionSinkNodeIds).not.toContain('known-handoff');
    expect(persisted.doneCriteria.completionSinkNodeIds).not.toContain('legacy-handoff');
  });

  test('re-planning full-replaces plan nodes and preserves locked past nodes', async () => {
    const taskId = 'task-v2-8';
    const graph = {
      id: 'graph-8',
      taskId,
      graphVersion: 1,
      mode: 'SIMPLE',
      nodes: {
        root: { type: 'root', status: 'done', deps: [], title: 'Task root', objective: 'Global chat', graphCreated: true, criteria: [] },
        plan: {
          type: 'work',
          status: 'pending',
          deps: ['root'],
          title: 'Generate execution plan',
          description: 'Generate plan',
          attempts: 0,
          maxAttempts: 2,
          retryPolicy: { backoffMs: 5000, onExhaust: 'escalate' },
          output: {
            draftNodeIds: ['foundation', 'backend-api', 'frontend-ui', 'integration', 'quality-gate', 'handoff-gate'],
            draftSinkNodeIds: ['handoff-gate'],
          },
        },
        'plan-approval': {
          type: 'gate',
          status: 'pending',
          gateType: 'approval_gate',
          required: true,
          deps: ['plan'],
          verificationStrategy: { type: 'human' },
        },
        foundation: {
          type: 'work',
          status: 'done',
          title: 'Foundation',
          description: 'Current foundation',
          where: ['frontend: app shell'],
          whatChanges: ['Keep global chat shell wiring'],
          acceptanceCriteria: ['Shell is in place'],
          todos: ['Validate shell'],
          verification: ['Manual check'],
          deps: ['plan-approval'],
          generatedByPlanNodeId: 'plan',
          planNodeKey: 'foundation',
          attempts: 0,
          maxAttempts: 2,
          retryPolicy: { backoffMs: 5000, onExhaust: 'escalate' },
          estimateMinutes: 10,
        },
        'backend-api': {
          type: 'work',
          status: 'done',
          title: 'Backend API',
          description: 'Current backend API',
          where: ['backend: /api/chat'],
          whatChanges: ['Current API wiring'],
          acceptanceCriteria: ['API exists'],
          todos: ['Keep API'],
          verification: ['Route check'],
          deps: ['foundation'],
          generatedByPlanNodeId: 'plan',
          planNodeKey: 'backend-api',
          attempts: 0,
          maxAttempts: 2,
          retryPolicy: { backoffMs: 5000, onExhaust: 'escalate' },
          estimateMinutes: 20,
        },
        'frontend-ui': {
          type: 'work',
          status: 'done',
          title: 'Frontend UI',
          description: 'Current UI and UX states',
          where: ['frontend: chat panel'],
          whatChanges: ['Current panel, loading and error states'],
          acceptanceCriteria: ['UI states are covered'],
          todos: ['Keep panel behavior'],
          verification: ['Visual check'],
          deps: ['foundation'],
          generatedByPlanNodeId: 'plan',
          planNodeKey: 'frontend-ui',
          attempts: 0,
          maxAttempts: 2,
          retryPolicy: { backoffMs: 5000, onExhaust: 'escalate' },
          estimateMinutes: 20,
          output: { summary: 'keep me done' },
        },
        integration: {
          type: 'work',
          status: 'done',
          title: 'Integration',
          description: 'Current integration',
          where: ['frontend/backend'],
          whatChanges: ['Current integration step'],
          acceptanceCriteria: ['Integrated'],
          todos: ['Keep integration'],
          verification: ['Smoke test'],
          deps: ['backend-api', 'frontend-ui'],
          generatedByPlanNodeId: 'plan',
          planNodeKey: 'integration',
          attempts: 0,
          maxAttempts: 2,
          retryPolicy: { backoffMs: 5000, onExhaust: 'escalate' },
          estimateMinutes: 20,
        },
        'quality-gate': {
          type: 'gate',
          status: 'pending',
          gateType: 'quality_gate',
          required: true,
          deps: ['integration'],
          generatedByPlanNodeId: 'plan',
          planNodeKey: 'quality-gate',
        },
        'handoff-gate': {
          type: 'gate',
          status: 'pending',
          gateType: 'handoff_gate',
          required: true,
          deps: ['quality-gate'],
          verificationStrategy: { type: 'human' },
          generatedByPlanNodeId: 'plan',
          planNodeKey: 'handoff-gate',
        },
      },
      edges: [
        { from: 'root', to: 'plan', type: 'hard', condition: 'always' },
        { from: 'plan', to: 'plan-approval', type: 'hard', condition: 'always' },
        { from: 'plan-approval', to: 'foundation', type: 'hard', condition: 'on_success' },
        { from: 'foundation', to: 'backend-api', type: 'hard', condition: 'on_success' },
        { from: 'foundation', to: 'frontend-ui', type: 'hard', condition: 'on_success' },
        { from: 'backend-api', to: 'integration', type: 'hard', condition: 'on_success' },
        { from: 'frontend-ui', to: 'integration', type: 'hard', condition: 'on_success' },
        { from: 'integration', to: 'quality-gate', type: 'hard', condition: 'on_success' },
        { from: 'quality-gate', to: 'handoff-gate', type: 'hard', condition: 'on_success' },
      ],
      policy: { maxConcurrent: 1 },
      doneCriteria: { completionSinkNodeIds: ['handoff-gate'] },
    };

    const invalidReplannedDraft = {
      nodes: {
        foundation: {
          type: 'work',
          title: 'Foundation',
          description: 'Current foundation',
          where: ['frontend: app shell'],
          whatChanges: ['Keep global chat shell wiring'],
          acceptanceCriteria: ['Shell is in place'],
          todos: ['Validate shell'],
          verification: ['Manual check'],
          estimateMinutes: 10,
          deps: [],
        },
        'backend-api': {
          type: 'work',
          title: 'Backend API',
          description: 'Updated backend API contract for chat orchestration',
          where: ['backend: /api/chat', 'backend: service layer'],
          whatChanges: ['Adjust request/response contract', 'Add orchestration endpoint behavior'],
          acceptanceCriteria: ['API contract is explicit'],
          todos: ['Update API contract docs', 'Add orchestration behavior notes'],
          verification: ['Route contract tests listed'],
          deps: ['foundation'],
        },
        'frontend-ui': {
          type: 'work',
          title: 'Frontend UI',
          description: 'Current UI and UX states',
          where: ['frontend: chat panel'],
          whatChanges: ['Current panel, loading and error states'],
          acceptanceCriteria: ['UI states are covered'],
          todos: ['Keep panel behavior'],
          verification: ['Visual check'],
          estimateMinutes: 20,
          deps: ['foundation'],
        },
        integration: {
          type: 'work',
          title: 'Integration',
          description: 'Current integration',
          where: ['frontend/backend'],
          whatChanges: ['Current integration step'],
          acceptanceCriteria: ['Integrated'],
          todos: ['Keep integration'],
          verification: ['Smoke test'],
          estimateMinutes: 20,
          deps: ['backend-api', 'frontend-ui'],
        },
        'quality-gate': {
          type: 'gate',
          gateType: 'quality_gate',
          required: true,
          deps: ['integration'],
        },
        'handoff-gate': {
          type: 'gate',
          gateType: 'handoff_gate',
          required: true,
          deps: ['quality-gate'],
          verificationStrategy: { type: 'human' },
        },
      },
      edges: [
        { from: 'foundation', to: 'backend-api', type: 'hard' },
        { from: 'foundation', to: 'frontend-ui', type: 'hard' },
        { from: 'backend-api', to: 'integration', type: 'hard' },
        { from: 'frontend-ui', to: 'integration', type: 'hard' },
        { from: 'integration', to: 'quality-gate', type: 'hard' },
        { from: 'quality-gate', to: 'handoff-gate', type: 'hard' },
      ],
    };

    const validReplannedDraft = {
      nodes: {
        'final-polish': {
          type: 'work',
          title: 'Final UI polish',
          description: 'Wrap remaining chat UI quality work after integration with explicit UX states',
          where: ['frontend: chat UI interaction polish', 'backend: chat telemetry'],
          whatChanges: ['Finalize UI polish and UX instrumentation expectations', 'Confirm post-integration backend telemetry checks'],
          acceptanceCriteria: ['Remaining UI polish scope is explicit', 'UX verification checklist is complete for final pass'],
          todos: ['Define final UI polish checklist', 'Capture final UX and backend telemetry validations'],
          verification: ['Checklist covers smoke, UX states, and regression checks'],
          deps: ['integration'],
        },
        'quality-gate': {
          type: 'gate',
          gateType: 'quality_gate',
          required: true,
          deps: ['final-polish'],
        },
        'handoff-gate': {
          type: 'gate',
          gateType: 'handoff_gate',
          required: true,
          deps: ['quality-gate'],
          verificationStrategy: { type: 'human' },
        },
      },
      edges: [
        { from: 'integration', to: 'final-polish', type: 'hard' },
        { from: 'final-polish', to: 'quality-gate', type: 'hard' },
        { from: 'quality-gate', to: 'handoff-gate', type: 'hard' },
      ],
    };

    const storage = makeStorage();
    const cloudRequest = makeCloudRequest(graph);
    const planner = jest.fn()
      .mockResolvedValueOnce(JSON.stringify(invalidReplannedDraft))
      .mockResolvedValueOnce(JSON.stringify(validReplannedDraft));
    const env = makeEnv({
      runSingleAgentPlanIteration: planner,
    });
    const { runV2GraphExecutionLoop } = createCloudExecuteGraphV2(env);

    const result = await runV2GraphExecutionLoop({
      taskId,
      task: { id: taskId, title: 'Replan global chat UI and UX', execution_graph: graph },
      provider: 'gemini',
      model: null,
      logger: { log: jest.fn() },
      storage,
      projectSlug: 'agx',
      taskSlug: 'replan-merge',
      stageLocal: 'execute',
      initialPromptContext: '',
      cancellationWatcher: null,
      cloudRequest,
    });

    expect(result.code).toBe(1);
    expect(result.decision.decision).toBe('blocked');
    expect(planner).toHaveBeenCalledTimes(2);
    const replanPrompt = planner.mock.calls[0][0]?.prompt || '';
    expect(replanPrompt).toContain('You are RE-SCOPING an existing graph');
    expect(replanPrompt).toContain('Current plan snapshot (node id, type, status, deps, title):');
    const persisted = cloudRequest.getPersisted();
    expect(persisted.nodes['foundation'].status).toBe('done');
    expect(persisted.nodes['frontend-ui'].status).toBe('done');
    expect(persisted.nodes['frontend-ui'].output.summary).toBe('keep me done');
    expect(persisted.nodes['backend-api'].description).toBe('Current backend API');
    expect(persisted.nodes['backend-api'].status).toBe('done');
    expect(persisted.nodes['integration'].status).toBe('done');
    expect(persisted.nodes['final-polish'].status).toBe('pending');
    expect(persisted.nodes['quality-gate'].status).toBe('pending');
    expect(persisted.nodes['handoff-gate'].status).toBe('pending');
  });
});
