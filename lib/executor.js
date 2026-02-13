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
  } = options;

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
      parseMarkers(chunk, { onLog, onProgress, taskId });
      
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

    proc.on('error', (err) => {
      clearStageTimeout();
      require('./telemetry').track('executor_spawn_error', { engine, error: err.message });
      settle(reject)(new Error(`Failed to spawn ${engine}: ${err.message}`));
    });

    proc.on('close', (code) => {
      clearStageTimeout();
      onProgress?.(100);
      
      if (code === 0 || code === null) {
        onLog?.(`[${engine}] Stage completed successfully`);
        require('./telemetry').track('executor_completed', { engine, stage, duration_ms: Date.now() - execStart });
        settle(resolve)({
          success: true,
          output,
          workDir,
          exitCode: code,
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

/**
 * Parse output markers from agent output
 */
function parseMarkers(text, { onLog, onProgress, taskId }) {
  // [checkpoint: message]
  const checkpointMatch = text.match(/\[checkpoint:\s*([^\]]+)\]/i);
  if (checkpointMatch) {
    onLog?.(`[checkpoint] ${checkpointMatch[1]}`);
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
    onLog?.(`[blocked] ${blockedMatch[1]}`);
  }

  // [done]
  if (/\[done\]/i.test(text)) {
    onLog?.(`[done] Stage marked complete`);
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
