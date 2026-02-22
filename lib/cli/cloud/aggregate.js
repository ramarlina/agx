/* eslint-disable no-console */
'use strict';

function createCloudAggregateHelpers(env) {
  const {
    SWARM_TIMEOUT_MS,
    SWARM_RETRIES,
    pRetryFn,
    logExecutionFlow,
    runAgxCommand,
    resolveStageObjective,
    buildStageRequirementPrompt,
    enforceStageRequirement,
    ensureExplanation,
    ensureNextPrompt,
    extractFileRefsFromText,
    extractJson,
    signalOrchestratorTask,
    buildAggregatorPrompt,
    resolveAggregatorModel,
    abortIfCancelled,
  } = env || {};

  async function runSingleAgentAggregate({ task, taskId, prompt, output, iteration, logger, provider, model, artifacts, cancellationWatcher }) {
    logExecutionFlow('runSingleAgentAggregate', 'input', `taskId=${taskId}, iteration=${iteration}`);
    logExecutionFlow('runSingleAgentAggregate', 'processing', 'running aggregator');
    const stageKey = task?.stage || 'unknown';
    const stagePrompt = resolveStageObjective(task, stageKey, '');
    const stageRequirement = buildStageRequirementPrompt({ stage: stageKey, stagePrompt });
    const aggregatorProvider = String(provider || task?.provider || task?.engine || 'claude').toLowerCase();
    const aggregatorModel = typeof model === 'string' && model.trim() ? model.trim() : null;
    const fileRefs = extractFileRefsFromText(output, { max: 20 });

    const aggregatePrompt = buildAggregatorPrompt({
      role: 'single-agent',
      taskId,
      task,
      stagePrompt,
      stageRequirement,
      runPath: artifacts?.runPath || null,
      fileRefs,
    });
    artifacts?.recordPrompt(`Aggregator Prompt (${aggregatorProvider}${aggregatorModel ? `/${aggregatorModel}` : ''})`, aggregatePrompt);

    // WARNING: keep `-y` in this aggregator invocation shape.
    // This is intentionally lock-tested in cloud command-path tests.
    const aggregateArgs = [aggregatorProvider, '-y', '--prompt', aggregatePrompt, '--print'];
    if (aggregatorModel) {
      aggregateArgs.push('--model', aggregatorModel);
    }

    await abortIfCancelled(cancellationWatcher);
    const res = await pRetryFn(
      () => runAgxCommand(aggregateArgs, SWARM_TIMEOUT_MS, `agx ${aggregatorProvider} aggregate`, {
        onStdout: (data) => logger?.log('checkpoint', data),
        onStderr: (data) => logger?.log('error', data),
        onTrace: (event) => {
          void artifacts?.recordEngineTrace?.({ provider: aggregatorProvider, model: aggregatorModel || null, role: 'single-aggregate' }, event);
        },
        cancellationWatcher,
      }),
      { retries: SWARM_RETRIES }
    );

    const decision = extractJson(res.stdout) || extractJson(res.stderr);
    logExecutionFlow('runSingleAgentAggregate', 'output', `decision=${JSON.stringify(decision || {})}`);
    if (!decision) {
      logger?.log('error', '[single] Aggregator returned invalid JSON\n');
      return { done: true, decision: 'failed', explanation: 'Aggregator response was not valid JSON.', final_result: 'Aggregator response was not valid JSON.', next_prompt: '', summary: 'Aggregator response was not valid JSON.' };
    }

    logger?.log('checkpoint', `[single] decision ${JSON.stringify(decision)}\n`);

    return ensureExplanation(enforceStageRequirement({
      done: Boolean(decision.done),
      decision: typeof decision.decision === 'string' ? decision.decision : '',
      explanation: typeof decision.explanation === 'string' ? decision.explanation : '',
      final_result: typeof decision.final_result === 'string' ? decision.final_result : '',
      next_prompt: typeof decision.next_prompt === 'string' ? decision.next_prompt : '',
      summary: typeof decision.summary === 'string' ? decision.summary : ''
    }, { stage: stageKey, stagePrompt }));
  }

  async function runSwarmAggregate({ task, taskId, prompt, results, iteration, logger, artifacts }) {
    const providerList = results.map((r) => r.provider).join(',');
    logExecutionFlow('runSwarmAggregate', 'input', `taskId=${taskId}, iteration=${iteration}, providers=${providerList}`);
    const stageKey = task?.stage || 'unknown';
    const stagePrompt = resolveStageObjective(task, stageKey, '');
    const stageRequirement = buildStageRequirementPrompt({ stage: stageKey, stagePrompt });
    const aggregatorProvider = String(task?.engine || task?.provider || 'claude').toLowerCase();
    const aggregatorModel = resolveAggregatorModel(task);
    const fileRefs = extractFileRefsFromText(
      results.map((r) => r?.output || '').filter(Boolean).join('\n\n'),
      { max: 20 }
    );

    const aggregatePrompt = buildAggregatorPrompt({
      role: 'swarm',
      taskId,
      task,
      stagePrompt,
      stageRequirement,
      runPath: artifacts?.runPath || null,
      fileRefs,
    });
    artifacts?.recordPrompt(`Swarm Aggregator Prompt (${aggregatorProvider}${aggregatorModel ? `/${aggregatorModel}` : ''})`, aggregatePrompt);

    // WARNING: keep `-y` in this aggregator invocation shape.
    // This is intentionally lock-tested in cloud command-path tests.
    const aggregateArgs = [aggregatorProvider, '-y', '--prompt', aggregatePrompt, '--print'];
    if (aggregatorModel) {
      aggregateArgs.push('--model', aggregatorModel);
    }

    logExecutionFlow('runSwarmAggregate', 'processing', 'running aggregator');
    const res = await pRetryFn(
      () => runAgxCommand(aggregateArgs, SWARM_TIMEOUT_MS, `agx ${aggregatorProvider} aggregate`, {
        onStdout: (data) => logger?.log('checkpoint', data),
        onStderr: (data) => logger?.log('error', data),
        onTrace: (event) => {
          void artifacts?.recordEngineTrace?.({ provider: aggregatorProvider, model: aggregatorModel || null, role: 'swarm-aggregate' }, event);
          void signalOrchestratorTask(taskId, 'daemonStep', {
            kind: 'runAgxCommand',
            task_id: taskId,
            provider: aggregatorProvider,
            model: aggregatorModel || null,
            role: 'swarm-aggregate',
            iteration,
            providers: results.map((r) => r.provider),
            ...event,
          });
        },
      }),
      { retries: SWARM_RETRIES }
    );

    const decision = extractJson(res.stdout) || extractJson(res.stderr);
    logExecutionFlow('runSwarmAggregate', 'output', `decision=${JSON.stringify(decision || {})}`);
    if (!decision) {
      logger?.log('error', '[swarm] Aggregator returned invalid JSON\n');
      return {
        done: true,
        decision: 'failed',
        explanation: 'Aggregator response was not valid JSON.',
        final_result: 'Aggregator response was not valid JSON.',
        next_prompt: '',
        summary: 'Aggregator response was not valid JSON.'
      };
    }

    logger?.log('checkpoint', `[swarm] decision ${JSON.stringify(decision)}\n`);

    return enforceStageRequirement({
      done: Boolean(decision.done),
      decision: typeof decision.decision === 'string' ? decision.decision : '',
      explanation: typeof decision.explanation === 'string' ? decision.explanation : '',
      final_result: typeof decision.final_result === 'string' ? decision.final_result : '',
      next_prompt: typeof decision.next_prompt === 'string' ? decision.next_prompt : '',
      summary: typeof decision.summary === 'string' ? decision.summary : ''
    }, { stage: stageKey, stagePrompt });
  }

  return { runSingleAgentAggregate, runSwarmAggregate };
}

module.exports = { createCloudAggregateHelpers };
