/* eslint-disable no-console */
'use strict';

const { createCloudCommandHelpers } = require('./command');
const { createCloudPromptHelpers } = require('./prompts');
const { createCloudPersistenceHelpers } = require('./persist');
const { createCloudIterationHelpers } = require('./iterations');
const { createCloudAggregateHelpers } = require('./aggregate');
const { createCloudExecuteVerifySingle } = require('./executeVerifySingle');
const { createCloudExecuteVerifySwarm } = require('./executeVerifySwarm');
const { createCloudExecuteGraphV2 } = require('./executeGraphV2');
const { createCloudSimpleLoops } = require('./simpleLoops');
const { createCloudTaskHelpers } = require('./taskLogger');

function createCloudRunner(env) {
  const baseEnv = env || {};

  const task = createCloudTaskHelpers(baseEnv);
  baseEnv.patchTaskState = task.patchTaskState;
  baseEnv.createTaskLogger = task.createTaskLogger;

  const command = createCloudCommandHelpers(baseEnv);
  baseEnv.updateCloudTask = command.updateCloudTask;
  baseEnv.runAgxCommand = command.runAgxCommand;

  const prompts = createCloudPromptHelpers(baseEnv);
  baseEnv.resolveAggregatorModel = prompts.resolveAggregatorModel;
  baseEnv.buildAggregatorPrompt = prompts.buildAggregatorPrompt;
  baseEnv.truncateForPrompt = prompts.truncateForPrompt;
  baseEnv.buildExecuteIterationPrompt = prompts.buildExecuteIterationPrompt;
  baseEnv.buildVerifyPrompt = prompts.buildVerifyPrompt;

  const persistence = createCloudPersistenceHelpers(baseEnv);
  baseEnv.appendRunContainerLog = persistence.appendRunContainerLog;
  baseEnv.finalizeRunSafe = persistence.finalizeRunSafe;
  baseEnv.persistIterationArtifacts = persistence.persistIterationArtifacts;

  const iterations = createCloudIterationHelpers(baseEnv);
  baseEnv.runSwarmIteration = iterations.runSwarmIteration;
  baseEnv.runSingleAgentIteration = iterations.runSingleAgentIteration;
  baseEnv.runSingleAgentPlanIteration = iterations.runSingleAgentPlanIteration;

  const aggregate = createCloudAggregateHelpers(baseEnv);
  baseEnv.runSingleAgentAggregate = aggregate.runSingleAgentAggregate;
  baseEnv.runSwarmAggregate = aggregate.runSwarmAggregate;

  const execVerifySingle = createCloudExecuteVerifySingle(baseEnv);
  baseEnv.runSingleAgentExecuteVerifyLoop = execVerifySingle.runSingleAgentExecuteVerifyLoop;

  const execVerifySwarm = createCloudExecuteVerifySwarm(baseEnv);
  baseEnv.runSwarmExecuteVerifyLoop = execVerifySwarm.runSwarmExecuteVerifyLoop;

  const execGraphV2 = createCloudExecuteGraphV2(baseEnv);
  baseEnv.runV2GraphExecutionLoop = execGraphV2.runV2GraphExecutionLoop;

  const simpleLoops = createCloudSimpleLoops(baseEnv);
  baseEnv.runSingleAgentLoop = simpleLoops.runSingleAgentLoop;
  baseEnv.runSwarmLoop = simpleLoops.runSwarmLoop;

  return {
    ...task,
    ...command,
    ...prompts,
    ...persistence,
    ...iterations,
    ...aggregate,
    ...execVerifySingle,
    ...execVerifySwarm,
    ...execGraphV2,
    ...simpleLoops,
  };
}

module.exports = { createCloudRunner };
