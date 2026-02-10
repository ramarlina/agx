/* eslint-disable no-console */
'use strict';

function createCloudSimpleLoops(env) {
  const {
    c,
    SWARM_MAX_ITERS,
    logExecutionFlow,
    createTaskLogger,
    patchTaskState,
    postTaskComment,
    ensureExplanation,
    ensureNextPrompt,
    runSwarmIteration,
    runSwarmAggregate,
    runSingleAgentIteration,
    runSingleAgentAggregate,
    truncateForComment,
    cleanAgentOutputForComment,
    abortIfCancelled,
    CancellationRequestedError,
    buildNextPromptWithDecisionContext,
  } = env || {};

  async function runSingleAgentLoop({ taskId, task, provider, model, logger, onStdout, onStderr, artifacts, cancellationWatcher }) {
    logExecutionFlow('runSingleAgentLoop', 'input', `taskId=${taskId}, provider=${provider}, model=${model}`);
    let iteration = 1;
    let prompt = '';
    let lastDecision = null;

    while (iteration <= 2) {
      logExecutionFlow('runSingleAgentLoop', 'processing', `iteration ${iteration} start`);
      logger?.log('system', `[single] iteration ${iteration} start\n`);
      if (iteration === 1) {
        console.log(`${c.dim}[single] Starting single-agent run...${c.reset}`);
      }
      let output = '';
      await abortIfCancelled(cancellationWatcher);
      try {
        output = await runSingleAgentIteration({ taskId, task, provider, model, prompt, logger, onStdout, onStderr, artifacts, cancellationWatcher });
        await abortIfCancelled(cancellationWatcher);
        artifacts?.recordOutput(`Agent Output (${provider}${model ? `/${model}` : ''}, iter ${iteration})`, output);

        // Do not remove this part
        // Get the last part of the output
        const finalComment = truncateForComment(cleanAgentOutputForComment(output));

        // Post as comment to the task
        await postTaskComment(taskId, finalComment);

      } catch (err) {
        if (err instanceof CancellationRequestedError) {
          throw err;
        }
        const message = err?.stdout || err?.stderr || err?.message || 'Single-agent run failed.';
        console.log(`${c.red}[single] Failed: ${err?.message || 'Single-agent run failed.'}${c.reset}`);
        logExecutionFlow('runSingleAgentLoop', 'output', `iteration ${iteration} failed ${err?.message || 'run failed'}`);
        lastDecision = {
          decision: 'failed',
          explanation: err?.message || 'Single-agent run failed.',
          final_result: message,
          summary: err?.message || 'Single-agent run failed.',
          done: false
        };
        return { code: 1, decision: lastDecision };
      }

      const decision = ensureExplanation(ensureNextPrompt(
        await runSingleAgentAggregate({
          task,
          taskId,
          prompt,
          output,
          iteration,
          logger,
          provider,
          model,
          artifacts,
          cancellationWatcher,
        })
      ));

      console.log(JSON.stringify(decision, null, 2));
      lastDecision = decision;

      // Post as comment to the task
      await postTaskComment(taskId, decision.summary);

      if (decision.summary) {
        console.log(`${c.dim}[single] Decision: ${decision.summary}${c.reset}`);
      }
      logExecutionFlow('runSingleAgentLoop', 'output', `decision ${iteration} ${decision.decision}`);

      if (['done', 'blocked'].includes(decision.decision)) {
        logExecutionFlow('runSingleAgentLoop', 'output', `done at iteration ${iteration}`);
        return { code: 0, decision: lastDecision };
      }

      prompt = (typeof buildNextPromptWithDecisionContext === 'function'
        ? buildNextPromptWithDecisionContext(decision)
        : (decision?.next_prompt || ''));
      iteration += 1;
    }

    if (!lastDecision) {
      lastDecision = {
        decision: 'not_done',
        explanation: 'Single-agent run reached max iterations.',
        final_result: 'Single-agent run reached max iterations.',
        summary: 'Single-agent run reached max iterations.',
        done: false
      };
    }

    return { code: 1, decision: lastDecision };
  }

  async function runSwarmLoop({ taskId, task, artifacts, cancellationWatcher }) {
    logExecutionFlow('runSwarmLoop', 'input', `taskId=${taskId}`);
    let iteration = 1;
    let prompt = '';
    const logger = createTaskLogger(taskId);
    let lastDecision = null;

    await patchTaskState(taskId, { status: 'in_progress', started_at: new Date().toISOString() });
    logger.log('system', `[swarm] start ${new Date().toISOString()}\n`);

    try {
      while (iteration <= SWARM_MAX_ITERS) {
        logExecutionFlow('runSwarmLoop', 'processing', `starting iteration ${iteration}`);
        const results = await runSwarmIteration({ taskId, task, prompt, logger, artifacts, cancellationWatcher });
        if (Array.isArray(results)) {
          for (const r of results) {
            artifacts?.recordOutput(`Swarm Output (${r.provider}, iter ${iteration})`, r.output || '');
          }
        }
        const decision = ensureExplanation(ensureNextPrompt(
          await runSwarmAggregate({ task, taskId, prompt, results, iteration, logger, artifacts })
        ));
        lastDecision = decision;

        if (decision.summary) {
          console.log(`${c.dim}[swarm] ${decision.summary}${c.reset}`);
        }
        await postTaskComment(taskId, decision.summary);
        logExecutionFlow('runSwarmLoop', 'output', `iteration ${iteration} decision=${decision.decision}`);

        if (decision.done) {
          logExecutionFlow('runSwarmLoop', 'output', `done at iteration ${iteration}`);
          logger.log('system', `[swarm] done ${new Date().toISOString()}\n`);
          await logger.flushAll();
          await patchTaskState(taskId, { status: 'completed', completed_at: new Date().toISOString() });
          return { code: 0, decision: lastDecision };
        }

        prompt = (typeof buildNextPromptWithDecisionContext === 'function'
          ? buildNextPromptWithDecisionContext(decision)
          : (decision?.next_prompt || ''));
        iteration += 1;
      }

      if (SWARM_MAX_ITERS > 0) {
        console.log(`${c.yellow}[swarm] Max iterations reached (${SWARM_MAX_ITERS}).${c.reset}`);
        logExecutionFlow('runSwarmLoop', 'output', `max iterations reached ${SWARM_MAX_ITERS}`);
        logger.log('system', `[swarm] max iterations reached\n`);
        await logger.flushAll();
        await patchTaskState(taskId, { completed_at: new Date().toISOString() });
        if (!lastDecision) {
          lastDecision = {
            decision: 'not_done',
            explanation: 'Swarm reached max iterations.',
            final_result: 'Swarm reached max iterations.',
            summary: 'Swarm reached max iterations.',
            done: false
          };
        }
        return { code: 1, decision: lastDecision };
      }
      await logger.flushAll();
      await patchTaskState(taskId, { completed_at: new Date().toISOString() });
      return { code: 0, decision: lastDecision };
    } catch (err) {
      logger.log('error', `[swarm] failed: ${err.message}\n`);
      logExecutionFlow('runSwarmLoop', 'output', `failed ${err?.message || 'unknown'}`);
      await logger.flushAll();
      await patchTaskState(taskId, { status: 'failed', completed_at: new Date().toISOString() });
      if (!lastDecision) {
        lastDecision = {
          decision: 'failed',
          explanation: err?.message || 'Swarm failed.',
          final_result: err?.message || 'Swarm failed.',
          summary: err?.message || 'Swarm failed.',
          done: false
        };
      }
      return { code: 1, decision: lastDecision };
    }
  }

  return { runSingleAgentLoop, runSwarmLoop };
}

module.exports = { createCloudSimpleLoops };
