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

const DEFAULT_STAGE_PROMPT = 'Execute this stage using the latest stage prompt from the cloud task context.';

const PROJECT_CONTEXT = [
  'AGX orchestrates autonomous AI agents with tasks defined via `agx new` and managed through `agx run`, `agx tasks`, `agx status`, and `agx context` so agents can wake, work, and sleep across sessions.',
  'Task state lives in the cloud API (goal, criteria, progress, learnings) along with the orchestration worker (pg-boss); `agx info`/`agx context` expose structured project metadata.',
  'Quick-start workflow: `agx new "<goal>"`, optionally `agx -a -p "<goal>"` for autonomous execution, then use `agx run`, `agx tasks`, `agx status`, and `agx context` to manage work.',
  'Task management commands include `agx task ls`, `agx task logs`, `agx task stop`, `agx task rm`, `agx complete`, `agx pull`.',
  'Daemon mode runs via `agx daemon start/stop/status/logs` so agents can poll for work continuously.',
  'Providers: `agx claude` (alias `c`), `agx gemini` (alias `g`), and `agx ollama` (alias `o`).',
  'Key flags: `-a/--autonomous`, `-p/--prompt`, `--prompt-file`, `-y/--yolo`, `--continue <task>`.',
  'Key principles: persistent storage, criteria-driven completion, checkpoint often, ask when stuck, learn and adapt.',
  'Agent workflow: orient on saved state, plan, execute, checkpoint, adapt to blockers, and report learnings.',
  'State operations: define objectives via `agx new`, update learnings with `[learn: ...]`, mark completion via `agx complete`, and sync via `agx info`/`agx context`.',
  'Project metadata: attach `--metadata key=value` and `--repo` info so `/api/projects` keeps structured context.',
].join('\n');

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
      settle(reject)(new Error(`Failed to spawn ${engine}: ${err.message}`));
    });

    proc.on('close', (code) => {
      clearStageTimeout();
      onProgress?.(100);
      
      if (code === 0 || code === null) {
        onLog?.(`[${engine}] Stage completed successfully`);
        settle(resolve)({
          success: true,
          output,
          workDir,
          exitCode: code,
        });
      } else {
        onLog?.(`[${engine}] Stage failed with exit code ${code}`);
        settle(reject)(new Error(`${engine} exited with code ${code}`));
      }
    });

    // Set a timeout for the process (30 minutes max per stage)
    timeout = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
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
  return `# Task: ${title}

## Stage: ${stage}

${stageConfig.prompt}

## Project Context

${PROJECT_CONTEXT}

## Task Details

${content}

## Instructions

1. Complete the work for this stage
2. Use [checkpoint: message] to save progress
3. Use [learn: insight] to record learnings
4. Use [done] when stage is complete
5. Use [blocked: reason] if you need human help

Focus on this stage only. The task will automatically advance to the next stage when complete.
`;
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
