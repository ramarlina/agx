'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { createCloudCommandHelpers } = require('../../../../lib/cli/cloud/command');
const { createCloudIterationHelpers } = require('../../../../lib/cli/cloud/iterations');
const { createCloudAggregateHelpers } = require('../../../../lib/cli/cloud/aggregate');

function makeChildProcess(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

describe('cloud command-path arg lock tests', () => {
  test('runAgxCommand preserves caller-provided -y flag and arg ordering', async () => {
    const child = makeChildProcess();
    const spawnCloudTaskProcess = jest.fn(() => child);
    const sanitizeCliArgs = jest.fn((args) => args);

    const { runAgxCommand } = createCloudCommandHelpers({
      sanitizeCliArgs,
      spawnCloudTaskProcess,
      logExecutionFlow: jest.fn(),
      randomId: () => 'trace-1',
      appendTail: (prev, chunk) => prev + chunk,
      truncateForTemporalTrace: (text) => text,
      extractCancellationReason: () => null,
      CancellationRequestedError: class CancellationRequestedError extends Error { },
      CANCELLED_ERROR_CODE: 'CANCELLED',
      scheduleTermination: () => ({ cancel: jest.fn() }),
      getProcessManager: () => null,
    });

    const pending = runAgxCommand(['claude', '-y', '--cloud-task', 'task-1'], 1000, 'agx claude');
    setImmediate(() => {
      child.stdout.write('ok');
      child.stderr.write('warn');
      child.emit('close', 0);
    });

    const result = await pending;

    // LOCK TEST: do not change this command shape casually.
    expect(spawnCloudTaskProcess).toHaveBeenCalledWith(
      [process.argv[1], 'claude', '-y', '--cloud-task', 'task-1'],
      { cwd: undefined, env: undefined }
    );
    expect(sanitizeCliArgs).toHaveBeenCalled();
    expect(result).toEqual({ stdout: 'ok', stderr: 'warn', code: 0 });
  });

  test('runSingleAgentIteration keeps -y in agx invocation', async () => {
    const runAgxCommand = jest.fn().mockResolvedValue({ stdout: 'done', stderr: '', code: 0 });
    const helpers = createCloudIterationHelpers({
      SWARM_PROVIDERS: ['claude'],
      SWARM_TIMEOUT_MS: 5000,
      SWARM_RETRIES: 0,
      pMap: async (arr, fn) => Promise.all(arr.map(fn)),
      pRetryFn: (fn) => fn(),
      commandExists: () => true,
      logExecutionFlow: jest.fn(),
      runAgxCommand,
      updateCloudTask: jest.fn(),
      abortIfCancelled: async () => {},
    });

    await helpers.runSingleAgentIteration({
      taskId: 'task-2',
      task: {},
      provider: 'claude',
      model: null,
      prompt: 'next step',
      logger: { log: jest.fn() },
      artifacts: { recordPrompt: jest.fn(), recordEngineTrace: jest.fn() },
      cancellationWatcher: null,
    });

    // LOCK TEST: -y is mandatory in cloud command path unless reviewed and coordinated.
    expect(runAgxCommand).toHaveBeenCalledWith(
      ['claude', '-y', '--cloud-task', 'task-2', '--prompt', 'next step'],
      5000,
      'agx claude',
      expect.any(Object)
    );
  });

  test('runSwarmAggregate keeps -y in aggregator invocation', async () => {
    const runAgxCommand = jest.fn().mockResolvedValue({
      stdout: JSON.stringify({
        done: false,
        decision: 'not_done',
        explanation: 'continue',
        final_result: '',
        next_prompt: 'continue',
        summary: 'continue',
      }),
      stderr: '',
      code: 0,
    });

    const helpers = createCloudAggregateHelpers({
      SWARM_TIMEOUT_MS: 7000,
      SWARM_RETRIES: 0,
      pRetryFn: (fn) => fn(),
      logExecutionFlow: jest.fn(),
      runAgxCommand,
      resolveStageObjective: () => 'ship feature',
      buildStageRequirementPrompt: () => 'stage requirement',
      enforceStageRequirement: (x) => x,
      ensureExplanation: (x) => x,
      ensureNextPrompt: (x) => x,
      extractFileRefsFromText: () => [],
      extractJson: (text) => JSON.parse(text),
      signalTemporalTask: jest.fn(),
      buildAggregatorPrompt: () => 'AGG_PROMPT',
      resolveAggregatorModel: () => null,
      abortIfCancelled: async () => {},
    });

    await helpers.runSwarmAggregate({
      task: { engine: 'claude', stage: 'execution' },
      taskId: 'task-3',
      prompt: '',
      results: [{ provider: 'claude', output: 'out' }],
      iteration: 1,
      logger: { log: jest.fn() },
      artifacts: { runPath: '/tmp/run', recordPrompt: jest.fn(), recordEngineTrace: jest.fn() },
    });

    // LOCK TEST: keep -y and this positional shape for aggregator command construction.
    expect(runAgxCommand).toHaveBeenCalledWith(
      ['claude', '-y', '--prompt', 'AGG_PROMPT', '--print'],
      7000,
      'agx claude aggregate',
      expect.any(Object)
    );
  });

  test('verify loop files still include hardcoded -y in verifyArgs', () => {
    const singleVerifySource = fs.readFileSync(
      path.join(__dirname, '../../../../lib/cli/cloud/executeVerifySingle.js'),
      'utf8'
    );
    const swarmVerifySource = fs.readFileSync(
      path.join(__dirname, '../../../../lib/cli/cloud/executeVerifySwarm.js'),
      'utf8'
    );

    // LOCK TEST: source-level contract for caller arg construction.
    expect(singleVerifySource).toMatch(/const verifyArgs = \[provider, '-y', '--prompt', verifyPrompt, '--print'\];/);
    expect(swarmVerifySource).toMatch(/const verifyArgs = \[verifierProvider, '-y', '--prompt', verifyPrompt, '--print'\];/);
  });
});
