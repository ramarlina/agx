/* eslint-disable no-console */
'use strict';

function createCloudExecuteVerifySwarm(env) {
  const {
    path,
    fs,
    SWARM_RETRIES,
    SWARM_MAX_ITERS,
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
    runSwarmIteration,
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
    resolveAggregatorModel,
    signalTemporalTask,
    buildNextPromptWithDecisionContext,
  } = env || {};

  const baseProcEnv = typeof process !== 'undefined' && process.env ? process.env : {};

  async function runSwarmExecuteVerifyLoop({ taskId, task, logger, storage, projectSlug, taskSlug, stageLocal, initialPromptContext, cancellationWatcher }) {
    logExecutionFlow('runSwarmExecuteVerifyLoop', 'input', `taskId=${taskId}`);

    const agentCwd = require('os').homedir();
    const stageKey = task?.stage || 'unknown';
    const stagePrompt = resolveStageObjective(task, stageKey, '');
    const stageRequirement = buildStageRequirementPrompt({ stage: stageKey, stagePrompt });

    let iteration = 1;
    let nextPrompt = '';
    let lastDecision = null;
    let lastRun = null;
    let lastRunEntry = null;

    const verifierProvider = String(task?.engine || task?.provider || 'claude').toLowerCase();
    const verifierModel = resolveAggregatorModel(task);

    while (iteration <= SWARM_MAX_ITERS) {
      logger?.log('system', `[swarm] execute/verify iteration ${iteration} start\n`);
      await abortIfCancelled(cancellationWatcher);

      const executeRun = await storage.createRun({
        projectSlug,
        taskSlug,
        stage: stageLocal,
        engine: verifierProvider,
        model: verifierModel || undefined,
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

      // EXECUTE (swarm iteration)
      let results;
      try {
        const runEnv = {
          ...baseProcEnv,
          AGX_RUN_ROOT: executeRun?.paths?.root || '',
          AGX_RUN_PLAN_DIR: executeRun?.paths?.plan || '',
          AGX_RUN_ARTIFACTS_DIR: executeRun?.paths?.artifacts || '',
        };
        results = await runSwarmIteration({
          taskId,
          task,
          prompt: nextPrompt ? buildExecuteIterationPrompt(nextPrompt, iteration) : buildExecuteIterationPrompt('', iteration),
          env: runEnv,
          logger,
          artifacts: executeArtifacts,
          cancellationWatcher,
          onProviderStdout: (provider, chunk) => {
            if (!execStdoutStream) return;
            execStdoutStream.write(`[${provider}] ${chunk.toString()}`);
          },
          onProviderStderr: (provider, chunk) => {
            if (!execStderrStream) return;
            execStderrStream.write(`[${provider}] ${chunk.toString()}`);
          },
          cwd: agentCwd,
        });
      } catch (err) {
        executeArtifacts.recordOutput('Execute Error', String(err?.message || err));
        await executeArtifacts.flush();
        try { execStdoutStream?.end(); } catch { }
        try { execStderrStream?.end(); } catch { }
        await storage.failRun(executeRun, { error: err?.message || 'swarm execute failed', code: 'EXECUTE_FAILED' });
        lastDecision = {
          done: false,
          decision: 'failed',
          explanation: err?.message || 'Swarm execute phase failed.',
          final_result: err?.message || 'Swarm execute phase failed.',
          next_prompt: '',
          summary: err?.message || 'Swarm execute phase failed.',
        };
        return { code: 1, decision: lastDecision, lastRun, runIndexEntry: lastRunEntry };
      } finally {
        try { execStdoutStream?.end(); } catch { }
        try { execStderrStream?.end(); } catch { }
      }

      const combinedOutput = Array.isArray(results)
        ? results.map((r) => `[${r.provider}]\n${r.output || ''}`).join('\n\n')
        : '';
      executeArtifacts.recordOutput(`Swarm Output (iter ${iteration})`, combinedOutput);
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
        engine: verifierProvider,
        model: verifierModel || undefined,
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
        agentOutput: combinedOutput,
      });
      const verifyArtifacts = createDaemonArtifactsRecorder({ storage, run: verifyRun, taskId });
      verifyArtifacts.recordPrompt(`Verification Prompt (${verifierProvider}${verifierModel ? `/${verifierModel}` : ''}, iter ${iteration})`, verifyPrompt);

      const verifyArgs = [verifierProvider, '-y', '--prompt', verifyPrompt, '--print'];
      if (verifierModel) verifyArgs.push('--model', verifierModel);

      let verifyRes;
      try {
        await abortIfCancelled(cancellationWatcher);
        const verifyEnv = {
          ...baseProcEnv,
          AGX_RUN_ROOT: verifyRun?.paths?.root || '',
          AGX_RUN_PLAN_DIR: verifyRun?.paths?.plan || '',
          AGX_RUN_ARTIFACTS_DIR: verifyRun?.paths?.artifacts || '',
        };
        verifyRes = await pRetryFn(
          () => runAgxCommand(verifyArgs, VERIFY_TIMEOUT_MS, `agx ${verifierProvider} verify`, {
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
              void verifyArtifacts?.recordEngineTrace?.({ provider: verifierProvider, model: verifierModel || null, role: 'swarm-verify' }, event);
              void signalTemporalTask(taskId, 'daemonStep', {
                kind: 'runAgxCommand',
                task_id: taskId,
                provider: verifierProvider,
                model: verifierModel || null,
                role: 'swarm-verify',
                iteration,
                ...event,
              });
            },
            cancellationWatcher,
            cwd: agentCwd,
          }),
          { retries: SWARM_RETRIES }
        );
      } catch (err) {
        verifyArtifacts.recordOutput('Verifier Error', String(err?.message || err));
        await persistIterationArtifacts(storage, { runContainerPath, executeRun, verifyRun, decision: {}, verifyCommands, verifyResults, gitSummary });
        await verifyArtifacts.flush();
        try { verifyStdoutStream?.end(); } catch { }
        try { verifyStderrStream?.end(); } catch { }
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
      } finally {
        try { verifyStdoutStream?.end(); } catch { }
        try { verifyStderrStream?.end(); } catch { }
      }

      const verifierText = verifyRes?.stdout || verifyRes?.stderr || '';
      verifyArtifacts.recordOutput(`Verifier Output (${verifierProvider}${verifierModel ? `/${verifierModel}` : ''}, iter ${iteration})`, verifierText);

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
        explanation: `Swarm run reached max iterations (${SWARM_MAX_ITERS}).`,
        final_result: `Swarm run reached max iterations (${SWARM_MAX_ITERS}).`,
        next_prompt: '',
        summary: `Swarm run reached max iterations (${SWARM_MAX_ITERS}).`,
      };
    }

    return { code: 1, decision: lastDecision, lastRun, runIndexEntry: lastRunEntry };
  }

  return { runSwarmExecuteVerifyLoop };
}

module.exports = { createCloudExecuteVerifySwarm };
