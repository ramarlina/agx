/**
 * Task Executor - Runs tasks with AI agents (Claude, Gemini, Ollama)
 *
 * Stage prompts are provided by cloud task payloads sourced from DB stage_prompts.
 * The executor spawns the appropriate CLI and captures output.
 */

const execa = require('execa');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { commandExists } = require('./proc/commandExists');
const { interpolate, DEFAULT_STAGE_PROMPT, PROJECT_CONTEXT, EXECUTOR_PROMPT } = require('./prompts/templates');
const { createCheckpoint, checkpointsPath } = require('./storage/checkpoints');
const { captureGitState } = require('./storage/git');
const { createCloudSyncer } = require('./cloud-sync');
const { runVerifyGate } = require('./verify-gate');

let json5;
try {
  json5 = require('json5');
} catch {
  json5 = null;
}

// Engine configurations
const ENGINES = {
  claude: {
    cmd: 'claude',
    args: ['--dangerously-skip-permissions', '-p'],
    available: () => commandExists('claude'),
  },
  gemini: {
    cmd: 'gemini',
    args: ['--yolo', '-p'],
    available: () => commandExists('gemini'),
  },
  ollama: {
    cmd: 'ollama',
    args: ['run'],
    available: () => commandExists('ollama'),
  },
};

function findStagePromptRecord(stagePrompts, stage) {
  if (!stagePrompts) return null;
  if (!stage) return null;

  if (Array.isArray(stagePrompts)) {
    const stageKey = String(stage).toLowerCase();
    const match = stagePrompts.find((entry) => String(entry?.stage || '').toLowerCase() === stageKey);
    return match || null;
  }

  if (typeof stagePrompts === 'object') {
    const direct = stagePrompts[stage] || stagePrompts[String(stage).toLowerCase()];
    if (direct) {
      if (typeof direct === 'string') {
        return { prompt: direct };
      }
      if (typeof direct === 'object') {
        return direct;
      }
    }
  }

  return null;
}

function resolveStageConfig(options) {
  const stage = options?.stage || 'coding';
  const record = findStagePromptRecord(
    options?.stage_prompts || options?.stagePrompts || options?.task?.stage_prompts || options?.task?.stagePrompts,
    stage
  );

  const prompt = (
    options?.stage_prompt
    || options?.stagePrompt
    || options?.task?.stage_prompt
    || options?.task?.stagePrompt
    || record?.prompt
  );

  const outputs = (
    options?.expected_outputs
    || options?.expectedOutputs
    || options?.task?.expected_outputs
    || options?.task?.expectedOutputs
    || record?.outputs
  );

  return {
    prompt: typeof prompt === 'string' && prompt.trim() ? prompt.trim() : DEFAULT_STAGE_PROMPT,
    outputs: Array.isArray(outputs) ? outputs : []
  };
}

/**
 * Execute a task stage with the specified engine
 */
async function executeTask(options) {
  const {
    taskId,
    title,
    content,
    stage,
    engine = 'claude',
    model,
    onLog,
    onProgress,
    onStream,
    projectSlug,
    taskSlug,
    iteration = 1,
    objective,
    constraints,
    dontRepeat,
    verifyFailures,
    plan: initialPlan,
    criteria: initialCriteria,
    repoPath,
  } = options;

  const iterationValue = (() => {
    const parsed = Number(iteration);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return parsed;
    }
    return 1;
  })();

  const gitCwd = typeof repoPath === 'string' && repoPath ? repoPath : process.cwd();

  const executionState = {
    plan: initialPlan || null,
    criteria: initialCriteria || null,
  };
  const pendingPersistence = new Set();
  const cloudSyncer = (() => {
    if (!projectSlug || !taskSlug || !options.cloudTaskId) return null;
    try {
      return createCloudSyncer({
        taskRoot: path.dirname(checkpointsPath(projectSlug, taskSlug)),
        cloudTaskId: options.cloudTaskId,
        onLog,
      });
    } catch (err) {
      onLog?.(`[cloud-sync] init failed: ${err?.message || err}`);
      return null;
    }
  })();

  const ensureDefaultPlan = () => {
    if (!executionState.plan && iterationValue === 1) {
      executionState.plan = createDefaultPlan();
    }
  };

  const captureGitStateSafe = () => {
    try {
      return captureGitState(gitCwd);
    } catch (err) {
      onLog?.(`[checkpoint] unable to record git state: ${err?.message || err}`);
      return null;
    }
  };

  const persistCheckpoint = async (label) => {
    if (!projectSlug || !taskSlug) return;
    const trimmedLabel = (label || '').toString().trim();
    if (!trimmedLabel) return;

    ensureDefaultPlan();
    const checkpointPayload = {
      label: trimmedLabel,
      iteration: iterationValue,
      objective,
      plan: executionState.plan,
      criteria: executionState.criteria,
      constraints,
      dontRepeat,
      verifyFailures,
      git: captureGitStateSafe(),
    };

    try {
      const checkpoint = await createCheckpoint(projectSlug, taskSlug, checkpointPayload);
      if (cloudSyncer && checkpoint) {
        try {
          await cloudSyncer.sync(checkpoint);
        } catch (err) {
          onLog?.(`[cloud-sync] sync failed: ${err?.message || err}`);
        }
      }
    } catch (err) {
      onLog?.(`[checkpoint] failed to persist: ${err?.message || err}`);
    }
  };

  const trackPersistence = (promise) => {
    if (!promise || typeof promise.then !== 'function') return;
    pendingPersistence.add(promise);
    promise.finally(() => pendingPersistence.delete(promise));
  };

  const flushPendingPersistence = async () => {
    if (pendingPersistence.size === 0) return;
    const pending = Array.from(pendingPersistence);
    onLog?.(`[checkpoint] waiting for ${pending.length} pending persistence operation(s)`);
    await Promise.allSettled(pending);
  };

  const handleCheckpoint = (label) => {
    trackPersistence(persistCheckpoint(label));
  };

  const handlePlanJson = (plan) => {
    if (plan && typeof plan === 'object') {
      executionState.plan = plan;
    }
  };

  const handleCriteriaJson = (criteria) => {
    if (criteria && typeof criteria === 'object') {
      executionState.criteria = criteria;
    }
  };

  const handleBlocked = async (blockedInfo) => {
    // Persist rich blocked state with current checkpoint data
    const richBlockedState = {
      ...blockedInfo,
      iteration: iterationValue,
      objective,
      plan: executionState.plan,
      criteria: executionState.criteria,
      constraints,
      dontRepeat,
      verifyFailures,
      git: captureGitStateSafe(),
    };
    
    // Save blocked state as a special checkpoint
    const persistBlockedPromise = (async () => {
      try {
        const checkpoint = await createCheckpoint(projectSlug, taskSlug, {
          ...richBlockedState,
          label: `blocked: ${blockedInfo.reason}`,
          blockedAt: blockedInfo.timestamp,
        });
        onLog?.(`[blocked] State persisted for recovery`);
        if (cloudSyncer && checkpoint) {
          try {
            await cloudSyncer.sync(checkpoint);
          } catch (err) {
            onLog?.(`[cloud-sync] sync failed: ${err?.message || err}`);
          }
        }
      } catch (err) {
        onLog?.(`[blocked] Failed to persist state: ${err?.message || err}`);
      }
    })();
    trackPersistence(persistBlockedPromise);
    await persistBlockedPromise;
  };

  const stageConfig = resolveStageConfig(options);
  const engineConfig = ENGINES[engine] || ENGINES.claude;

  // Check engine availability
  if (!engineConfig.available()) {
    throw new Error(`Engine '${engine}' is not installed. Run: agx add ${engine}`);
  }

  // Build the full prompt
  const prompt = buildPrompt(title, content, stage, stageConfig);

  // Create temp directory for outputs
  const workDir = path.join(os.homedir(), '.agx', 'workdir', `agx-${taskId}-${stage}`);
  if (!fs.existsSync(workDir)) {
    fs.mkdirSync(workDir, { recursive: true });
  }

  const execStart = Date.now();
  onLog?.(`[${engine}] Starting ${stage} stage...`);
  onProgress?.(10);

  return new Promise((resolve, reject) => {
    // Spawn the engine process
    let args = [...engineConfig.args];
    
    // Ollama syntax is `ollama run <model> <prompt>`
    if (engine === 'ollama') {
      const modelName = model || 'llama3.2:3b';
      args = ['run', modelName, prompt];
    } else {
      args.push(prompt);
    }

    const proc = execa(engineConfig.cmd, args, {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...engineConfig.env, TERM: 'dumb' },
      reject: false,
    });

    let output = '';
    let lastProgress = 10;

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      onStream?.(chunk);
      
      // Parse output markers
      parseMarkers(chunk, {
        onLog,
        onProgress,
        taskId,
        projectSlug,
        taskSlug,
        onCheckpoint: handleCheckpoint,
        onPlanJson: handlePlanJson,
        onCriteriaJson: handleCriteriaJson,
        onBlocked: handleBlocked,
      });
      
      // Increment progress as we get output
      lastProgress = Math.min(90, lastProgress + 5);
      onProgress?.(lastProgress);
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      onStream?.(chunk);
      // Log errors but don't fail (some engines write info to stderr)
      if (!chunk.includes('Warning') && !chunk.includes('Info')) {
        onLog?.(`[${engine}] ${chunk.trim()}`);
      }
    });

    let settled = false;
    const settle = (fn) => (arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };

    let timeout = null;
    const clearStageTimeout = () => {
      if (!timeout) return;
      clearTimeout(timeout);
      timeout = null;
    };

    // Auto-checkpoint every 5 minutes
    const AUTO_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;
    let autoCheckpointTimer = null;
    let autoCheckpointCount = 0;
    
    const startAutoCheckpoint = () => {
      if (autoCheckpointTimer) return;
      autoCheckpointTimer = setInterval(async () => {
        autoCheckpointCount++;
        onLog?.(`[checkpoint] auto-checkpoint #${autoCheckpointCount}`);
        await persistCheckpoint(`auto-5min-${autoCheckpointCount}`);
      }, AUTO_CHECKPOINT_INTERVAL_MS);
      autoCheckpointTimer.unref?.();
    };
    
    const stopAutoCheckpoint = () => {
      if (autoCheckpointTimer) {
        clearInterval(autoCheckpointTimer);
        autoCheckpointTimer = null;
      }
    };
    
    // Start auto-checkpoint timer
    startAutoCheckpoint();

    proc.on('error', (err) => {
      stopAutoCheckpoint();
      clearStageTimeout();
      require('./telemetry').track('executor_spawn_error', { engine, error: err.message });
      settle(reject)(new Error(`Failed to spawn ${engine}: ${err.message}`));
    });

    proc.on('close', async (code) => {
      stopAutoCheckpoint();
      clearStageTimeout();
      onProgress?.(100);
      await flushPendingPersistence();
      
      if (code === 0 || code === null) {
        onLog?.(`[${engine}] Stage process finished`);
        
        let gateResult = null;
        try {
          onLog?.(`[verify-gate] Running verification...`);
          gateResult = await runVerifyGate({
            criteria: executionState.criteria || [],
            cwd: gitCwd,
            verifyFailures: verifyFailures || 0,
            onLog
          });
          
          if (gateResult.forceAction) {
            onLog?.(`[verify-gate] Force action triggered: ${gateResult.reason}`);
            // We resolve as success but pass the gate result so the loop can handle the force action
          } else if (gateResult.passed) {
            onLog?.(`[verify-gate] Passed all checks`);
          } else {
            onLog?.(`[verify-gate] Checks failed or need LLM`);
          }
        } catch (err) {
           onLog?.(`[verify-gate] execution error: ${err.message}`);
        }

        require('./telemetry').track('executor_completed', { engine, stage, duration_ms: Date.now() - execStart });
        settle(resolve)({
          success: true,
          output,
          workDir,
          exitCode: code,
          gateResult,
        });
      } else {
        onLog?.(`[${engine}] Stage failed with exit code ${code}`);
        require('./telemetry').track('executor_failed', { engine, stage, exit_code: code, duration_ms: Date.now() - execStart });
        settle(reject)(new Error(`${engine} exited with code ${code}`));
      }
    });

    // Set a timeout for the process (30 minutes max per stage)
    timeout = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      require('./telemetry').track('executor_timeout', { engine, stage });
      settle(reject)(new Error(`Stage timed out after 30 minutes`));
    }, 30 * 60 * 1000);
    timeout.unref?.();

    proc.on('close', clearStageTimeout);
  });
}

/**
 * Build the full prompt for a stage
 */
function buildPrompt(title, content, stage, stageConfig) {
  return interpolate(EXECUTOR_PROMPT, {
    title,
    stage,
    stagePrompt: stageConfig.prompt,
    projectContext: PROJECT_CONTEXT,
    content,
  });
}

function createDefaultPlan() {
  return {
    steps: [
      { desc: 'Analyze', status: 'done' },
      { desc: 'Implement', status: 'in_progress' },
      { desc: 'Verify', status: 'todo' },
    ],
    current: 1,
  };
}

function tryParseJsonCandidate(candidate) {
  try {
    return JSON.parse(candidate);
  } catch (err) {
    if (json5) {
      try {
        return json5.parse(candidate);
      } catch (json5Err) {
        return null;
      }
    }
    return null;
  }
}

function extractJsonObjects(text, markerName) {
  if (!text || !markerName) return [];
  const lowerText = text.toLowerCase();
  const marker = `[${markerName.toLowerCase()}:`;
  const results = [];
  let cursor = 0;
  while (cursor < lowerText.length) {
    const markerIndex = lowerText.indexOf(marker, cursor);
    if (markerIndex === -1) break;
    const braceStart = text.indexOf('{', markerIndex + marker.length);
    if (braceStart === -1) {
      cursor = markerIndex + marker.length;
      continue;
    }
    let depth = 0;
    let sliceEnd = -1;
    for (let i = braceStart; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          sliceEnd = i;
          break;
        }
      }
    }
    if (sliceEnd === -1) {
      cursor = markerIndex + marker.length;
      continue;
    }
    const candidate = text.slice(braceStart, sliceEnd + 1);
    const parsed = tryParseJsonCandidate(candidate);
    if (parsed !== null) {
      results.push(parsed);
      cursor = sliceEnd + 1;
    } else {
      cursor = braceStart + 1;
    }
  }
  return results;
}

/**
 * Parse output markers from agent output
 */
function parseMarkers(text, {
  onLog,
  onProgress,
  taskId,
  projectSlug,
  taskSlug,
  onCheckpoint,
  onPlanJson,
  onCriteriaJson,
  onBlocked,
}) {
  // [checkpoint: message] - capture all occurrences in chunk
  const checkpointMatches = [...text.matchAll(/\[checkpoint:\s*([^\]]+)\]/gi)];
  for (const match of checkpointMatches) {
    onLog?.(`[checkpoint] ${match[1]}`);
    onCheckpoint?.(match[1]);
  }

  // [learn: insight]
  const learnMatch = text.match(/\[learn:\s*([^\]]+)\]/i);
  if (learnMatch) {
    onLog?.(`[learning] ${learnMatch[1]}`);
  }

  // [progress: N%]
  const progressMatch = text.match(/\[progress:\s*(\d+)%?\]/i);
  if (progressMatch) {
    onProgress?.(parseInt(progressMatch[1]));
  }

  // [blocked: reason]
  const blockedMatch = text.match(/\[blocked:\s*([^\]]+)\]/i);
  if (blockedMatch) {
    const reason = blockedMatch[1];
    onLog?.(`[blocked] ${reason}`);
    onBlocked?.({
      reason,
      timestamp: new Date().toISOString(),
      taskId,
      projectSlug,
      taskSlug,
    });
  }

  // [done]
  if (/\[done\]/i.test(text)) {
    onLog?.(`[done] Stage marked complete`);
  }

  const planObjects = extractJsonObjects(text, 'plan_json');
  for (const plan of planObjects) {
    onPlanJson?.(plan);
  }

  const criteriaObjects = extractJsonObjects(text, 'criteria_json');
  for (const criteria of criteriaObjects) {
    onCriteriaJson?.(criteria);
  }
}

/**
 * Check if all expected outputs were created
 */
function checkOutputs(workDir, expectedOutputs) {
  const missing = [];
  for (const output of expectedOutputs) {
    const filePath = path.join(workDir, output);
    if (!fs.existsSync(filePath)) {
      missing.push(output);
    }
  }
  return { complete: missing.length === 0, missing };
}

module.exports = { executeTask, ENGINES, resolveStageConfig };
