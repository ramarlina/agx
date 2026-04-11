import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import { getPromptJobStore } from './get-store';
import { pollDueJobs } from './engine';
import { getAgent, getAgentSkills } from '@/lib/db';
import { LOCAL_USER } from '@/lib/auth-mode';
import { runCliResponse, buildCliAttempts } from '@/lib/cli-runner';
import type { ChatProvider } from '@/lib/types';
import type { PromptJob, PromptRun } from './types';

let registeredPump: (() => Promise<void>) | null = null;
let pumpPending = false;
let pumpScheduled = false;
let pumpRunning = false;

const AGENTS_DIR = join(homedir(), '.agx', 'agents');

/** Build a short command string for process identification (used by stale-run reaper). */
function buildHostCommand(provider: ChatProvider, model: string | null): string {
  const attempts = buildCliAttempts({ provider, model, prompt: '', systemPrompt: undefined });
  if (attempts.length > 0) {
    const { command, args } = attempts[0];
    // Store enough of the command to identify it — the binary + first few args
    return `${command} ${args.slice(0, 3).join(' ')}`;
  }
  return provider;
}

async function hydrateAgent(agentId: string): Promise<{
  provider: ChatProvider;
  model: string | null;
  identity: string | undefined;
  self: string | undefined;
  skills: string | undefined;
}> {
  const agent = await getAgent(agentId, LOCAL_USER.id);
  if (!agent) return { provider: 'claude', model: null, identity: undefined, self: undefined, skills: undefined };

  const agentDir = join(AGENTS_DIR, agentId);

  let identity: string | undefined;
  const parts: string[] = [];
  if (agent.name) parts.push(`Name: ${agent.name}`);
  if (agent.description) parts.push(agent.description);
  if (agent.voice) parts.push(`Voice: ${agent.voice}`);
  if (parts.length > 0) identity = parts.join('\n');

  let self: string | undefined;
  const selfPath = join(agentDir, 'self.md');
  if (existsSync(selfPath)) {
    const raw = readFileSync(selfPath, 'utf-8');
    const match = raw.match(/^---[\s\S]*?---\s*\n?([\s\S]*)$/);
    self = match ? match[1].trim() : raw.trim();
    if (!self) self = undefined;
  }

  let skills: string | undefined;
  const agentSkills = await getAgentSkills(agentId);
  if (agentSkills.length > 0) {
    const skillTexts: string[] = [];
    for (const skill of agentSkills) {
      const skillPath = skill.file.startsWith('/') ? skill.file : join(agentDir, skill.file);
      if (existsSync(skillPath)) {
        try {
          const content = readFileSync(skillPath, 'utf-8');
          skillTexts.push(`## ${skill.file}\n${content}`);
        } catch (err) {
          console.error('[prompt-jobs/processor] failed to read skill file:', err);
        }
      }
    }
    if (skillTexts.length > 0) skills = skillTexts.join('\n\n');
  }

  return {
    provider: (agent.provider || 'claude') as ChatProvider,
    model: agent.model || null,
    identity,
    self,
    skills,
  };
}

async function resolveJobContext(job: PromptJob): Promise<{
  provider: ChatProvider;
  model: string | null;
  identity: string | undefined;
  self: string | undefined;
  skills: string | undefined;
}> {
  if (job.agentId) {
    return hydrateAgent(job.agentId);
  }
  return {
    provider: (job.provider || 'claude') as ChatProvider,
    model: job.model || null,
    identity: undefined,
    self: undefined,
    skills: undefined,
  };
}

async function executePrompt(opts: {
  provider: ChatProvider;
  model: string | null;
  prompt: string;
  identity?: string;
  self?: string;
  skills?: string;
  cliArgs?: string;
  onSpawn?: (pid: number) => void;
}): Promise<{ output: string; error: string; durationMs: number; status: 'success' | 'failed' }> {
  const startMs = Date.now();
  let output = '';

  try {
    await runCliResponse({
      provider: opts.provider,
      model: opts.model,
      prompt: opts.prompt,
      identity: opts.identity,
      self: opts.self,
      skills: opts.skills,
      passthroughArgs: opts.cliArgs ? opts.cliArgs.split(/\s+/).filter(Boolean) : undefined,
      onDelta: (chunk) => { output += chunk; },
      onSpawn: opts.onSpawn,
    });
    return { output, error: '', durationMs: Date.now() - startMs, status: 'success' };
  } catch (err) {
    return { output, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startMs, status: 'failed' };
  }
}

async function fireConditionGate(job: PromptJob, run: PromptRun) {
  const store = getPromptJobStore();
  const startedAt = new Date().toISOString();
  const fallbackHostCommand = buildHostCommand(
    (job.provider || 'claude') as ChatProvider,
    job.model || null,
  );
  store.updateRun(run.id, { status: 'running', startedAt, hostCommand: fallbackHostCommand });
  const ctx = await resolveJobContext(job);
  const gatePrompt = `You are a condition gate. Your job is to determine whether the following condition expression evaluates to "yes" (pass) or "no" (fail).\n\nRules:\n- If the condition is a boolean literal or expression (e.g. "true", "return True", "1 == 1"), evaluate it as code and respond based on its result.\n- If the condition is a natural-language statement, judge whether it holds.\n- If the condition is an instruction (e.g. "say yes", "always pass"), follow it.\n- Respond with ONLY "yes" or "no" (lowercase, nothing else).\n\nCondition: ${job.condition}`;

  const hostCommand = buildHostCommand(ctx.provider, ctx.model);
  if (hostCommand !== fallbackHostCommand) {
    store.updateRun(run.id, { hostCommand });
  }

  const gateResult = await executePrompt({
    ...ctx,
    prompt: gatePrompt,
    cliArgs: job.cliArgs,
    onSpawn: (pid) => { store.updateRun(run.id, { hostPid: pid }); },
  });
  const answer = gateResult.output.trim().toLowerCase();
  const passed = /\byes\b/.test(answer);

  if (gateResult.status !== 'success' || !passed) {
    store.updateRun(run.id, {
      status: 'success',
      output: `Gate: ${answer}\n(condition not met — skipped action)`,
      durationMs: gateResult.durationMs,
      finishedAt: new Date().toISOString(),
    });
    store.updateJob(job.id, { lastOutcome: 'success', lastRunAt: Date.now() });
    return;
  }

  store.updateRun(run.id, { output: `Gate: yes\nExecuting action prompt...`, hostPid: null });
  const actionResult = await executePrompt({
    ...ctx,
    prompt: job.prompt,
    cliArgs: job.cliArgs,
    onSpawn: (pid) => { store.updateRun(run.id, { hostPid: pid }); },
  });

  store.updateRun(run.id, {
    status: actionResult.status,
    output: `Gate: yes\n---\n${actionResult.output}`,
    error: actionResult.error || undefined,
    durationMs: gateResult.durationMs + actionResult.durationMs,
    finishedAt: new Date().toISOString(),
  });
  store.updateJob(job.id, { lastOutcome: actionResult.status, lastRunAt: Date.now() });
}

async function fireRun(job: PromptJob, run: PromptRun) {
  const store = getPromptJobStore();
  const startedAt = new Date().toISOString();
  const fallbackHostCommand = buildHostCommand(
    (job.provider || 'claude') as ChatProvider,
    job.model || null,
  );
  store.updateRun(run.id, { status: 'running', startedAt, hostCommand: fallbackHostCommand });
  const ctx = await resolveJobContext(job);

  const hostCommand = buildHostCommand(ctx.provider, ctx.model);
  if (hostCommand !== fallbackHostCommand) {
    store.updateRun(run.id, { hostCommand });
  }

  const result = await executePrompt({
    ...ctx,
    prompt: job.prompt,
    cliArgs: job.cliArgs,
    onSpawn: (pid) => { store.updateRun(run.id, { hostPid: pid }); },
  });

  store.updateRun(run.id, {
    status: result.status,
    output: result.output,
    error: result.error || undefined,
    durationMs: result.durationMs,
    finishedAt: new Date().toISOString(),
  });
  store.updateJob(job.id, { lastOutcome: result.status, lastRunAt: Date.now() });
}

function dispatchRun(job: PromptJob, run: PromptRun) {
  const fn = job.condition ? fireConditionGate : fireRun;
  void fn(job, run).catch((err) => {
    const store = getPromptJobStore();
    store.updateRun(run.id, {
      status: 'failed',
      error: `Dispatch error: ${err instanceof Error ? err.message : String(err)}`,
      finishedAt: new Date().toISOString(),
    });
    store.updateJob(job.id, { lastOutcome: 'failed' });
  });
}

function schedulePumpRun() {
  if (!registeredPump || pumpScheduled) return;
  pumpScheduled = true;
  setTimeout(() => {
    pumpScheduled = false;
    void drainPromptJobPump();
  }, 0);
}

async function drainPromptJobPump() {
  if (!registeredPump || pumpRunning) return;

  pumpRunning = true;
  try {
    while (pumpPending) {
      pumpPending = false;
      await registeredPump();
    }
  } finally {
    pumpRunning = false;
    if (pumpPending) {
      schedulePumpRun();
    }
  }
}

export function registerPromptJobPump(processor: () => Promise<void>): void {
  registeredPump = processor;
  if (pumpPending) {
    schedulePumpRun();
  }
}

export function requestPromptJobPump(): boolean {
  pumpPending = true;
  if (!registeredPump) {
    return false;
  }
  schedulePumpRun();
  return true;
}

export async function processPromptJobs(): Promise<{
  queued: PromptRun[];
  skipped: Array<{ jobId: string; reason: string }>;
  dispatched: number;
}> {
  const store = getPromptJobStore();
  const result = await pollDueJobs(store);
  const queuedRuns = store.listQueuedRuns(200);

  let dispatched = 0;
  for (const run of queuedRuns) {
    const job = store.getJob(run.jobId);
    if (!job) continue;
    dispatchRun(job, run);
    dispatched++;
  }

  return {
    queued: result.queued,
    skipped: result.skipped,
    dispatched,
  };
}
