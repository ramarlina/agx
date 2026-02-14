/* eslint-disable no-console */
'use strict';

function createCloudIterationHelpers(env) {
  const {
    SWARM_PROVIDERS,
    SWARM_TIMEOUT_MS,
    SWARM_RETRIES,
    pMap,
    pRetryFn,
    commandExists,
    logExecutionFlow,
    runAgxCommand,
    updateCloudTask,
    abortIfCancelled,
    // Note: additional helpers (comments, artifacts) are handled by higher-level loops.
  } = env || {};

  async function runSwarmIteration({ taskId, task, prompt, logger, artifacts, cancellationWatcher, onProviderStdout, onProviderStderr, env, cwd }) {
    logExecutionFlow('runSwarmIteration', 'input', `taskId=${taskId}, prompt=${Boolean(prompt)}`);
    const swarmModels = Array.isArray(task?.swarm_models)
      ? task.swarm_models
        .filter((entry) => entry && entry.provider && entry.model)
        .map((entry) => ({
          provider: String(entry.provider).toLowerCase(),
          model: String(entry.model)
        }))
      : [];

    const providers = (swarmModels.length ? swarmModels.map((m) => m.provider) : SWARM_PROVIDERS)
      .map((p) => p.toLowerCase());

    const missing = providers.filter((p) => !commandExists(p));
    if (missing.length) {
      throw new Error(`Missing providers for swarm run: ${missing.join(', ')}`);
    }

    logExecutionFlow('runSwarmIteration', 'processing', `providers=${providers.join(',')}`);
    logger?.log('system', `[swarm] iteration start\n`);

    const results = await pMap(providers, (provider, index) => {
      // WARNING: keep `-y` in this cloud-invoked command shape.
      // This is intentionally lock-tested; change only with coordinated test updates.
      const args = [provider, '-y', '--cloud-task', taskId];
      const modelForProvider = swarmModels.length
        ? swarmModels[index]?.model || null
        : null;
      if (modelForProvider) {
        args.push('--model', modelForProvider);
      }
      if (prompt) {
        // The agent already receives full task context via --cloud-task; keep the per-iteration
        // prompt narrowly scoped to the next instruction to avoid duplicating context.
        args.push('--prompt', String(prompt));
      }

      return pRetryFn(
        () => runAgxCommand(args, SWARM_TIMEOUT_MS, `agx ${provider}`, {
          env,
          cwd,
          onStdout: (data) => {
            if (typeof onProviderStdout === 'function') onProviderStdout(provider, data);
            logger?.log('output', data);
          },
          onStderr: (data) => {
            if (typeof onProviderStderr === 'function') onProviderStderr(provider, data);
            logger?.log('error', data);
          },
          onTrace: (event) => {
            void artifacts?.recordEngineTrace?.({ provider, model: swarmModels.length ? (swarmModels[index]?.model || null) : null, role: 'swarm-iteration' }, event);

            if (taskId) {
              if (event.phase === 'start' && event.pid) {
                void updateCloudTask(taskId, { pid: event.pid, started_at: event.started_at });
              }
              if (event.phase === 'exit') {
                void updateCloudTask(taskId, { exit_code: event.exit_code, completed_at: event.finished_at });
              }
            }
          }
          ,
          cancellationWatcher,
        }),
        {
          retries: SWARM_RETRIES,
        }
      ).then((res) => ({
        provider,
        output: res.stdout || res.stderr || ''
      }));
    }, { concurrency: providers.length });

    for (const result of results) {
      logger?.log('output', `\n[${result.provider}] ${result.output}\n`);
    }

    logExecutionFlow('runSwarmIteration', 'output', `providers finished count=${results.length}`);
    return results;
  }

  async function runSingleAgentIteration({ taskId, task, provider, model, prompt, logger, onStdout, onStderr, artifacts, cancellationWatcher, env, cwd }) {
    logExecutionFlow('runSingleAgentIteration', 'input', `taskId=${taskId}, provider=${provider}, model=${model}, prompt=${Boolean(prompt) ? 'present' : 'none'}`);
    logExecutionFlow('runSingleAgentIteration', 'processing', 'preparing runAgxCommand');
    // WARNING: keep `-y` in this cloud-invoked command shape.
    // This is intentionally lock-tested; change only with coordinated test updates.
    const args = [provider, '-y', '--cloud-task', taskId];
    if (model) {
      args.push('--model', model);
    }

    // Record iteration prompt for artifacts
    // For iteration 1, prompt is empty because context comes via --cloud-task
    // For subsequent iterations, prompt contains the next_prompt from aggregation
    const iterationLabel = `Agent Iteration Prompt (${provider}${model ? `/${model}` : ''})`;
    if (prompt) {
      const iterPrompt = String(prompt);
      artifacts?.recordPrompt(iterationLabel, iterPrompt);
      args.push('--prompt', iterPrompt);
    } else {
      // First iteration uses --cloud-task context (already recorded as Initial Task Context)
      artifacts?.recordPrompt(iterationLabel, `(First iteration: using --cloud-task ${taskId} context)`);
    }


    await abortIfCancelled(cancellationWatcher);
    const res = await pRetryFn(
      () => runAgxCommand(args, SWARM_TIMEOUT_MS, `agx ${provider}`, {
        env,
        cwd,
        onStdout: (data) => {
          if (onStdout) onStdout(data);
          logger?.log('output', data);
        },
        onStderr: (data) => {
          if (onStderr) onStderr(data);
          logger?.log('error', data);
        },
        onTrace: (event) => {
          void artifacts?.recordEngineTrace?.({ provider, model: model || null, role: 'single-iteration' }, event);

          if (taskId) {
            if (event.phase === 'start' && event.pid) {
              void updateCloudTask(taskId, { pid: event.pid, started_at: event.started_at });
            }
            if (event.phase === 'exit') {
              void updateCloudTask(taskId, { exit_code: event.exit_code, completed_at: event.finished_at });
            }
          }
        },
        cancellationWatcher,
      }),
      { retries: SWARM_RETRIES }
    );

    const outputSource = res.stdout || res.stderr || '';
    logExecutionFlow('runSingleAgentIteration', 'output', `response length=${outputSource.length}`);
    return res.stdout || res.stderr || '';
  }

  return { runSwarmIteration, runSingleAgentIteration };
}

module.exports = { createCloudIterationHelpers };
