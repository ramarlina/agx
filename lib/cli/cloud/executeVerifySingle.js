/* eslint-disable no-console */
'use strict';

function createCloudExecuteVerifySingle(env) {
  const {
    path,
    fs,
    SWARM_RETRIES,
    SINGLE_MAX_ITERS,
    VERIFY_TIMEOUT_MS,
    pRetryFn,
    logExecutionFlow,
    resolveStageObjective,
    buildStageRequirementPrompt,
    enforceStageRequirement,
    detectVerifyCommands,
    runVerifyCommands,
    getGitSummary,
    createDaemonArtifactsRecorder,
    runAgxCommand,
    runSingleAgentIteration,
    buildExecuteIterationPrompt,
    buildVerifyPrompt,
    persistIterationArtifacts,
    finalizeRunSafe,
    buildLocalRunIndexEntry,
    postTaskComment,
    extractJsonLast,
    ensureExplanation,
    ensureNextPrompt,
    abortIfCancelled,
    CancellationRequestedError,
    buildNextPromptWithDecisionContext,
  } = env || {};

  const baseProcEnv = typeof process !== 'undefined' && process.env ? process.env : {};

  async function runSingleAgentExecuteVerifyLoop({ taskId, task, provider, model, logger, storage, projectSlug, taskSlug, stageLocal, initialPromptContext, cancellationWatcher }) {
    logExecutionFlow('runSingleAgentExecuteVerifyLoop', 'input', `taskId=${taskId}, provider=${provider}, model=${model}`);

    const agentCwd = require('os').homedir();
    const stageKey = task?.stage || 'unknown';
    const stagePrompt = resolveStageObjective(task, stageKey, '');
    const stageRequirement = buildStageRequirementPrompt({ stage: stageKey, stagePrompt });

    let iteration = 1;
    let nextPrompt = '';
    let lastDecision = null;
    let lastRun = null;
    let lastRunEntry = null;

    while (iteration <= SINGLE_MAX_ITERS) {
      logger?.log('system', `[single] execute/verify iteration ${iteration} start\n`);
      logExecutionFlow('runSingleAgentExecuteVerifyLoop', 'processing', `iteration ${iteration} start`);
      await abortIfCancelled(cancellationWatcher);

      const executeRun = await storage.createRun({
        projectSlug,
        taskSlug,
        stage: stageLocal,
        engine: provider,
        model: model || undefined,
      });
      lastRun = executeRun;
      const runContainerPath = executeRun?.paths?.root ? path.dirname(executeRun.paths.root) : null;

      const executeArtifacts = createDaemonArtifactsRecorder({ storage, run: executeRun, taskId });
      if (iteration === 1 && initialPromptContext) {
        executeArtifacts.recordPrompt('Initial Task Context', initialPromptContext);
      }

      // Tee spawned agx output into files under execute artifacts.
      const execStdoutPath = executeRun?.paths?.artifacts ? path.join(executeRun.paths.artifacts, 'spawned.stdout.log') : null;
      const execStderrPath = executeRun?.paths?.artifacts ? path.join(executeRun.paths.artifacts, 'spawned.stderr.log') : null;
      const execStdoutStream = execStdoutPath ? fs.createWriteStream(execStdoutPath, { flags: 'a' }) : null;
      const execStderrStream = execStderrPath ? fs.createWriteStream(execStderrPath, { flags: 'a' }) : null;

      // EXECUTE
      const executePrompt = buildExecuteIterationPrompt(nextPrompt, iteration);
      let output = '';
      try {
        const runEnv = {
          ...baseProcEnv,
          AGX_RUN_ROOT: executeRun?.paths?.root || '',
          AGX_RUN_PLAN_DIR: executeRun?.paths?.plan || '',
          AGX_RUN_ARTIFACTS_DIR: executeRun?.paths?.artifacts || '',
        };
        output = await runSingleAgentIteration({
          taskId,
          task,
          provider,
          model,
          prompt: executePrompt,
          env: runEnv,
          logger,
          onStdout: (chunk) => {
            try { execStdoutStream?.write(chunk.toString()); } catch { }
          },
          onStderr: (chunk) => {
            try { execStderrStream?.write(chunk.toString()); } catch { }
          },
          artifacts: executeArtifacts,
          cancellationWatcher,
          cwd: agentCwd,
        });
      } catch (err) {
        const message = err?.stdout || err?.stderr || err?.message || 'Single-agent execute phase failed.';
        executeArtifacts.recordOutput('Execute Error', String(message));
        await executeArtifacts.flush();
        try { execStdoutStream?.end(); } catch { }
        try { execStderrStream?.end(); } catch { }
        await storage.failRun(executeRun, { error: err?.message || 'execute failed', code: 'EXECUTE_FAILED' });
        lastDecision = {
          done: false,
          decision: 'failed',
          explanation: err?.message || 'Single-agent execute phase failed.',
          final_result: message,
          next_prompt: '',
          summary: err?.message || 'Single-agent execute phase failed.',
        };
        return { code: 1, decision: lastDecision, lastRun, runIndexEntry: lastRunEntry };
      }
      try { execStdoutStream?.end(); } catch { }
      try { execStderrStream?.end(); } catch { }
      executeArtifacts.recordOutput(`Agent Output (${provider}${model ? `/${model}` : ''}, iter ${iteration})`, output);
      await executeArtifacts.flush();

      // VERIFY (local commands)
      const verifyCommands = detectVerifyCommands({ cwd: agentCwd });
      const gitSummary = getGitSummary({ cwd: agentCwd });
      const verifyResults = await runVerifyCommands(verifyCommands, { cwd: agentCwd, max_output_chars: 20000 });

      const verifyRun = await storage.createRun({
        projectSlug,
        taskSlug,
        stage: 'verify',
        runId: executeRun.run_id,
        engine: provider,
        model: model || undefined,
      });
      lastRun = verifyRun;

      // Tee verifier stdout/stderr to files under verify artifacts.
      const verifyStdoutPath = verifyRun?.paths?.artifacts ? path.join(verifyRun.paths.artifacts, 'spawned.stdout.log') : null;
      const verifyStderrPath = verifyRun?.paths?.artifacts ? path.join(verifyRun.paths.artifacts, 'spawned.stderr.log') : null;
      const verifyStdoutStream = verifyStdoutPath ? fs.createWriteStream(verifyStdoutPath, { flags: 'a' }) : null;
      const verifyStderrStream = verifyStderrPath ? fs.createWriteStream(verifyStderrPath, { flags: 'a' }) : null;

      // VERIFY (LLM)
      const verifyPrompt = buildVerifyPrompt({
        taskId,
        task,
        stagePrompt,
        stageRequirement,
        gitSummary,
        verifyResults,
        iteration,
        lastRunPath: runContainerPath || verifyRun?.paths?.root || null,
        agentOutput: output,
      });
      const verifyArtifacts = createDaemonArtifactsRecorder({ storage, run: verifyRun, taskId });
      verifyArtifacts.recordPrompt(`Verification Prompt (${provider}${model ? `/${model}` : ''}, iter ${iteration})`, verifyPrompt);

      // WARNING: keep `-y` in verifier invocation for cloud loops.
      // This command shape is lock-tested and should not be changed casually.
      const verifyArgs = [provider, '-y', '--prompt', verifyPrompt, '--print'];
      if (model) verifyArgs.push('--model', model);

      await abortIfCancelled(cancellationWatcher);

      let verifyRes;
      try {
        const verifyEnv = {
          ...baseProcEnv,
          AGX_RUN_ROOT: verifyRun?.paths?.root || '',
          AGX_RUN_PLAN_DIR: verifyRun?.paths?.plan || '',
          AGX_RUN_ARTIFACTS_DIR: verifyRun?.paths?.artifacts || '',
        };
        verifyRes = await pRetryFn(
          () => runAgxCommand(verifyArgs, VERIFY_TIMEOUT_MS, `agx ${provider} verify`, {
            env: verifyEnv,
            onStdout: (data) => {
              try { verifyStdoutStream?.write(data.toString()); } catch { }
              logger?.log('checkpoint', data);
            },
            onStderr: (data) => {
              try { verifyStderrStream?.write(data.toString()); } catch { }
              logger?.log('error', data);
            },
            onTrace: (event) => {
              void verifyArtifacts?.recordEngineTrace?.({ provider, model: model || null, role: 'single-verify' }, event);
            },
            cancellationWatcher,
            cwd: agentCwd,
          }),
          { retries: SWARM_RETRIES }
        );
      } catch (err) {
        try { verifyStdoutStream?.end(); } catch { }
        try { verifyStderrStream?.end(); } catch { }
        if (err instanceof CancellationRequestedError) {
          throw err;
        }
        verifyArtifacts.recordOutput('Verifier Error', String(err?.message || err));
        await persistIterationArtifacts(storage, { runContainerPath, executeRun, verifyRun, decision: {}, verifyCommands, verifyResults, gitSummary });
        await verifyArtifacts.flush();
        await storage.failRun(verifyRun, { error: err?.message || 'verify failed', code: 'VERIFY_FAILED' });
        await finalizeRunSafe(storage, executeRun, { status: 'failed', reason: `Verification failed: ${err?.message || 'verify failed'}` });
        lastDecision = {
          done: false,
          decision: 'failed',
          explanation: err?.message || 'Verifier failed.',
          final_result: err?.message || 'Verifier failed.',
          next_prompt: '',
          summary: err?.message || 'Verifier failed.',
        };
        return { code: 1, decision: lastDecision, lastRun, runIndexEntry: lastRunEntry };
      }
      try { verifyStdoutStream?.end(); } catch { }
      try { verifyStderrStream?.end(); } catch { }

      const verifierText = verifyRes?.stdout || verifyRes?.stderr || '';
      verifyArtifacts.recordOutput(`Verifier Output (${provider}${model ? `/${model}` : ''}, iter ${iteration})`, verifierText);

      let decision = extractJsonLast(verifierText);
      if (!decision) decision = extractJsonLast(verifyRes?.stderr || '');
      if (!decision) {
        decision = {
          done: false,
          decision: 'failed',
          explanation: 'Verifier returned invalid JSON.',
          final_result: 'Verifier returned invalid JSON.',
          next_prompt: '',
          summary: 'Verifier returned invalid JSON.',
        };
      }

      decision = ensureExplanation(ensureNextPrompt(enforceStageRequirement({
        done: Boolean(decision.done),
        decision: typeof decision.decision === 'string' ? decision.decision : '',
        explanation: typeof decision.explanation === 'string' ? decision.explanation : '',
        final_result: typeof decision.final_result === 'string' ? decision.final_result : '',
        next_prompt: typeof decision.next_prompt === 'string' ? decision.next_prompt : '',
        summary: typeof decision.summary === 'string' ? decision.summary : '',
        plan_md: typeof decision.plan_md === 'string' ? decision.plan_md : '',
        implementation_summary_md: typeof decision.implementation_summary_md === 'string' ? decision.implementation_summary_md : '',
        verification_md: typeof decision.verification_md === 'string' ? decision.verification_md : '',
      }, { stage: stageKey, stagePrompt })));

      lastDecision = decision;

      await persistIterationArtifacts(storage, { runContainerPath, executeRun, verifyRun, decision, verifyCommands, verifyResults, gitSummary });

      // Finalize this iteration (verify) run.
      verifyArtifacts.recordOutput('Daemon Decision', JSON.stringify(decision || {}, null, 2));
      await verifyArtifacts.flush();

      const statusMap = {
        done: 'done',
        blocked: 'blocked',
        not_done: 'continue',
        failed: 'failed',
      };
      const localDecisionStatus = statusMap[String(decision?.decision || 'failed')] || 'failed';
      await finalizeRunSafe(storage, executeRun, {
        status: localDecisionStatus,
        reason: 'Execute phase completed; see verify stage for decision.',
      });
      await finalizeRunSafe(storage, verifyRun, {
        status: localDecisionStatus,
        reason: decision?.explanation || decision?.summary || '',
      });

      lastRunEntry = await buildLocalRunIndexEntry(storage, verifyRun, localDecisionStatus);

      // Update local task status.
      const localTaskStatusMap = {
        done: 'done',
        blocked: 'blocked',
        not_done: 'running',
        failed: 'failed',
      };
      const nextLocalStatus = localTaskStatusMap[String(decision?.decision || 'failed')] || 'failed';
      await storage.updateTaskState(projectSlug, taskSlug, { status: nextLocalStatus });

      await postTaskComment(taskId, decision.summary || decision.explanation || '');

      if (['done', 'blocked', 'failed'].includes(String(decision?.decision || ''))) {
        const code = decision?.decision === 'done' ? 0 : 1;
        return { code, decision: lastDecision, lastRun, runIndexEntry: lastRunEntry };
      }

      nextPrompt = (typeof buildNextPromptWithDecisionContext === 'function'
        ? buildNextPromptWithDecisionContext(decision)
        : (decision?.next_prompt || ''));
      iteration += 1;
    }

    if (!lastDecision) {
      lastDecision = {
        done: false,
        decision: 'not_done',
        explanation: `Single-agent run reached max iterations (${SINGLE_MAX_ITERS}).`,
        final_result: `Single-agent run reached max iterations (${SINGLE_MAX_ITERS}).`,
        next_prompt: '',
        summary: `Single-agent run reached max iterations (${SINGLE_MAX_ITERS}).`,
      };
    }

    return { code: 1, decision: lastDecision, lastRun, runIndexEntry: lastRunEntry };
  }

  return { runSingleAgentExecuteVerifyLoop };
}

module.exports = { createCloudExecuteVerifySingle };
