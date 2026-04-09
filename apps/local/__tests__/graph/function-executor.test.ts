/**
 * @jest-environment node
 */

import { dispatchBashFunction, createDispatchFunction } from '@/src/graph/function-executor';
import type { ExecutionGraph, FunctionNode } from '@/src/graph/types';
import { DEFAULT_EXECUTION_POLICY } from '@/src/graph/constants';

jest.mock('@/lib/history-store', () => ({
  createChatRun: jest.fn(),
  getMessageThread: jest.fn(),
  getThreadStatusSnapshot: jest.fn(),
  loadHistory: jest.fn(),
  sweepStaleWorkingReactions: jest.fn(),
  saveMessages: jest.fn(),
  updateMessageStatus: jest.fn(),
}));

jest.mock('@/src/graph/store', () => ({
  deactivateSchedulesByRootMessageId: jest.fn(),
}));

jest.mock('@/lib/sqlite-query-adapter', () => ({
  getSQLiteDb: jest.fn(),
}));

jest.mock('@/lib/agent-participants', () => ({
  loadDbParticipants: jest.fn(),
}));

jest.mock('@/lib/chat/project-context', () => ({
  resolveProjectContext: jest.fn(),
}));

jest.mock('@/lib/orchestrator/runtime', () => ({
  ensureOrchestratorRuntime: jest.fn(),
}));

jest.mock('@/lib/queue/boss', () => ({
  QUEUE_NAMES: { CHAT_RUN_PROCESS: 'chat_run_process' },
  getQueue: jest.fn(),
}));

jest.mock('@/lib/debug-log', () => ({
  writeDebugLog: jest.fn(),
}));

function makeFunctionNode(overrides: Partial<FunctionNode> = {}): FunctionNode {
  return {
    type: 'function',
    status: 'pending',
    deps: [],
    kind: 'bash',
    title: 'test-function',
    command: "printf '{\"ok\":true}'",
    timeoutMs: 5_000,
    ...overrides,
  };
}

function makeGraph(): ExecutionGraph {
  return {
    id: 'test-graph',
    taskId: 'test-task',
    graphVersion: 1,
    mode: 'SIMPLE',
    nodes: {},
    edges: [],
    policy: DEFAULT_EXECUTION_POLICY,
    doneCriteria: { allRequiredGatesPassed: false, noRunnableOrPendingWork: true },
    versionHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('dispatchBashFunction', () => {
  test('returns success with parsed JSON output for valid command', async () => {
    const node = makeFunctionNode({
      command: "printf '{\"activeProcessCount\":0,\"messageCount\":5}'",
    });
    const graph = makeGraph();

    const result = await dispatchBashFunction(node, graph);

    expect(result.status).toBe('success');
    expect(result.output).toEqual({ activeProcessCount: 0, messageCount: 5 });
  });

  test('returns success with empty output for empty stdout', async () => {
    const node = makeFunctionNode({
      command: "printf ''",
    });
    const graph = makeGraph();

    const result = await dispatchBashFunction(node, graph);

    expect(result.status).toBe('success');
    expect(result.output).toEqual({});
  });

  test('returns success with raw output for non-JSON stdout', async () => {
    const node = makeFunctionNode({
      command: "printf 'not valid json'",
    });
    const graph = makeGraph();

    const result = await dispatchBashFunction(node, graph);

    expect(result.status).toBe('success');
    expect(result.output).toEqual({ raw: 'not valid json' });
  });

  test('returns failure for non-zero exit code', async () => {
    const node = makeFunctionNode({
      command: "exit 1",
    });
    const graph = makeGraph();

    const result = await dispatchBashFunction(node, graph);

    expect(result.status).toBe('failure');
    expect(result.message).toContain('exited with code 1');
  });

  test('enforces timeout for long-running commands', async () => {
    const node = makeFunctionNode({
      command: "sleep 10",
      timeoutMs: 50, // 50ms timeout
    });
    const graph = makeGraph();

    const start = Date.now();
    const result = await dispatchBashFunction(node, graph);
    const elapsed = Date.now() - start;

    expect(result.status).toBe('failure');
    expect(result.message).toContain('timed out');
    expect(elapsed).toBeLessThan(500); // Should fail fast, not wait 10 seconds
  });

  test('truncates stdout that exceeds buffer limit', async () => {
    // Create a command that outputs 100KB of JSON
    const node = makeFunctionNode({
      command: "node -e \"process.stdout.write(JSON.stringify({data:'a'.repeat(100000)}))\"",
    });
    const graph = makeGraph();

    const result = await dispatchBashFunction(node, graph);

    expect(result.status).toBe('failure');
    expect(result.message).toContain('exceeded');
    expect(result.message).toContain('bytes limit');
  });

  test('returns failure for unsupported kind', async () => {
    const node = {
      ...makeFunctionNode(),
      kind: 'mcp' as const,
    };
    const graph = makeGraph();

    const result = await dispatchBashFunction(node, graph);

    expect(result.status).toBe('failure');
    expect(result.message).toContain('Unsupported function node kind');
  });

  test('returns failure for empty command', async () => {
    const node = makeFunctionNode({
      command: '',
    });
    const graph = makeGraph();

    const result = await dispatchBashFunction(node, graph);

    expect(result.status).toBe('failure');
    expect(result.message).toContain('Empty command');
  });
});

describe('createDispatchFunction', () => {
  test('creates a dispatchFunction that handles bash nodes', async () => {
    const dispatchFunction = createDispatchFunction();
    const node = makeFunctionNode({
      command: "printf '{\"test\":true}'",
    });
    const graph = makeGraph();

    const result = await dispatchFunction(node, graph);

    expect(result.status).toBe('success');
    expect(result.output).toEqual({ test: true });
  });

  test('createDispatchFunction returns failure for unsupported kinds', async () => {
    const dispatchFunction = createDispatchFunction();
    const node = {
      ...makeFunctionNode(),
      kind: 'mcp' as const,
    };
    const graph = makeGraph();

    const result = await dispatchFunction(node, graph);

    expect(result.status).toBe('failure');
    expect(result.message).toContain('Unsupported function node kind');
  });

  test('handles internal thread-status commands without shelling out', async () => {
    const {
      getMessageThread,
      getThreadStatusSnapshot,
      sweepStaleWorkingReactions,
    } = jest.requireMock('@/lib/history-store') as {
      getMessageThread: jest.Mock;
      getThreadStatusSnapshot: jest.Mock;
      sweepStaleWorkingReactions: jest.Mock;
    };

    getMessageThread.mockResolvedValue({ threadId: 'thread-1' });
    getThreadStatusSnapshot.mockResolvedValue({
      processes: [{ status: 'running' }, { status: 'done' }],
      messages: [{ id: 'm1' }, { id: 'm2' }],
      lastUpdatedAt: 1234567890,
    });

    const dispatchFunction = createDispatchFunction();
    const node = makeFunctionNode({
      kind: 'internal',
      command: 'thread-status',
      args: { rootMessageId: 'root-1' },
    });
    const graph = makeGraph();

    const result = await dispatchFunction(node, graph);

    expect(result.status).toBe('success');
    expect(sweepStaleWorkingReactions).toHaveBeenCalledWith('thread-1');
    expect(result.output).toEqual({
      activeProcessCount: 1,
      messageCount: 2,
      threadId: 'thread-1',
      lastUpdatedAt: 1234567890,
    });
  });

  test('handles internal ship-mode-act commands without agx CLI', async () => {
    const {
      getThreadStatusSnapshot,
      getMessageThread,
      updateMessageStatus,
    } = jest.requireMock('@/lib/history-store') as {
      getThreadStatusSnapshot: jest.Mock;
      getMessageThread: jest.Mock;
      updateMessageStatus: jest.Mock;
    };
    const { deactivateSchedulesByRootMessageId } = jest.requireMock('@/src/graph/store') as {
      deactivateSchedulesByRootMessageId: jest.Mock;
    };

    getMessageThread.mockResolvedValue({ threadId: 'thread-1' });
    getThreadStatusSnapshot.mockResolvedValue({ processes: [], messages: [], lastUpdatedAt: 1234567890 });
    updateMessageStatus.mockResolvedValue(undefined);
    deactivateSchedulesByRootMessageId.mockReturnValue(1);

    const dispatchFunction = createDispatchFunction();
    const node = makeFunctionNode({
      kind: 'internal',
      command: 'ship-mode-act',
      args: { rootMessageId: 'root-1', steerNodeId: 'steer' },
    });
    const graph = makeGraph();
    graph.nodes.steer = {
      type: 'work',
      status: 'done',
      deps: [],
      title: 'Steer',
      attempts: 1,
      maxAttempts: 2,
      retryPolicy: { backoffMs: 0, onExhaust: 'fail' },
      output: { isDone: true, message: '[done]' },
    };

    const result = await dispatchFunction(node, graph);

    expect(result.status).toBe('success');
    expect(deactivateSchedulesByRootMessageId).toHaveBeenCalledWith('root-1');
    expect(updateMessageStatus).toHaveBeenCalledWith('thread-1', 'root-1', 'in-review', null);
    expect(result.output).toEqual({ done: true, action: 'stopped_and_in_review' });
  });

  test('ship-mode-act sends as the default project agent for the current thread', async () => {
    const {
      createChatRun,
      getMessageThread,
      loadHistory,
      saveMessages,
    } = jest.requireMock('@/lib/history-store') as {
      createChatRun: jest.Mock;
      getMessageThread: jest.Mock;
      loadHistory: jest.Mock;
      saveMessages: jest.Mock;
    };
    const { loadDbParticipants } = jest.requireMock('@/lib/agent-participants') as {
      loadDbParticipants: jest.Mock;
    };
    const { resolveProjectContext } = jest.requireMock('@/lib/chat/project-context') as {
      resolveProjectContext: jest.Mock;
    };
    const { ensureOrchestratorRuntime } = jest.requireMock('@/lib/orchestrator/runtime') as {
      ensureOrchestratorRuntime: jest.Mock;
    };
    const { getQueue } = jest.requireMock('@/lib/queue/boss') as {
      getQueue: jest.Mock;
    };
    const { getSQLiteDb } = jest.requireMock('@/lib/sqlite-query-adapter') as {
      getSQLiteDb: jest.Mock;
    };

    getMessageThread.mockResolvedValue({ threadId: 'thread-1' });
    loadHistory.mockResolvedValue([
      {
        id: 'root-1',
        role: 'user',
        participantId: null,
        content: 'Ship this change',
        timestamp: 1000,
      },
    ]);
    saveMessages.mockResolvedValue(undefined);
    createChatRun.mockResolvedValue({ id: 'chat-run-1' });
    loadDbParticipants.mockResolvedValue([
      { id: 'agent-primary', name: 'Primary', provider: 'claude', model: null, color: '#000' },
      { id: 'agent-helper', name: 'Helper', provider: 'claude', model: null, color: '#111' },
    ]);
    resolveProjectContext.mockResolvedValue(undefined);
    ensureOrchestratorRuntime.mockResolvedValue(undefined);
    const send = jest.fn().mockResolvedValue(undefined);
    getQueue.mockResolvedValue({ send });

    const projectThreadStmt = {
      get: jest.fn().mockReturnValue({ project_id: 'project-1', project_slug: 'alpha' }),
    };
    const projectAgentStmt = {
      all: jest.fn().mockReturnValue([{ agent_id: 'agent-primary' }, { agent_id: 'agent-helper' }]),
    };
    getSQLiteDb.mockReturnValue({
      prepare: jest.fn((sql: string) => {
        if (sql.includes("JOIN projects")) return projectThreadStmt;
        if (sql.includes("FROM project_agents")) return projectAgentStmt;
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    });

    const dispatchFunction = createDispatchFunction();
    const node = makeFunctionNode({
      kind: 'internal',
      command: 'ship-mode-act',
      args: { rootMessageId: 'root-1', steerNodeId: 'steer' },
    });
    const graph = makeGraph();
    graph.nodes.steer = {
      type: 'work',
      status: 'done',
      deps: [],
      title: 'Steer',
      attempts: 1,
      maxAttempts: 2,
      retryPolicy: { backoffMs: 0, onExhaust: 'fail' },
      output: { isDone: false, message: 'Keep shipping' },
    };

    const result = await dispatchFunction(node, graph);

    expect(saveMessages).toHaveBeenCalledTimes(1);
    expect(saveMessages).toHaveBeenCalledWith(
      'thread-1',
      [
        expect.objectContaining({
          role: 'assistant',
          participantId: 'agent-primary',
          content: 'Keep shipping',
          rootMessageId: 'root-1',
          parentMessageId: 'root-1',
          depth: 1,
        }),
      ],
    );
    expect(createChatRun).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        rootMessageId: 'root-1',
        projectSlug: 'alpha',
        activeParticipantIds: ['agent-helper'],
      }),
    );
    expect(send).toHaveBeenCalledWith('chat_run_process', expect.objectContaining({
      signal: 'start',
    }));
    expect(result.status).toBe('success');
    expect(result.output).toMatchObject({
      done: false,
      action: 'sent_next_steps_and_started_chat_run',
      sender: 'agent-primary',
      messageId: expect.any(String),
      chatRunId: expect.any(String),
    });
  });
});
