import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getPromptJobStore } from '@/src/prompt-scheduler/get-store';
import { pollDueJobs } from '@/src/prompt-scheduler/engine';
import { getAgent, getAgentSkills } from '@/lib/db';
import { LOCAL_USER } from '@/lib/auth-mode';
import { runCliResponse } from '@/lib/cli-runner';
import type { ChatProvider } from '@/lib/types';
import { computeNextRun } from '@/src/prompt-scheduler/cron';
import type { PromptJob, PromptRun } from '@/src/prompt-scheduler/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AGENTS_DIR = join(homedir(), '.agx', 'agents');

/** Hydrate agent context — identity, self.md, skills */
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

  // Identity (description + voice)
  let identity: string | undefined;
  const parts: string[] = [];
  if (agent.name) parts.push(`Name: ${agent.name}`);
  if (agent.description) parts.push(agent.description);
  if (agent.voice) parts.push(`Voice: ${agent.voice}`);
  if (parts.length > 0) identity = parts.join('\n');

  // Self.md (evolving bio)
  let self: string | undefined;
  const selfPath = join(agentDir, 'self.md');
  if (existsSync(selfPath)) {
    const raw = readFileSync(selfPath, 'utf-8');
    const match = raw.match(/^---[\s\S]*?---\s*\n?([\s\S]*)$/);
    self = match ? match[1].trim() : raw.trim();
    if (!self) self = undefined;
  }

  // Skills
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
        } catch {}
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

/** Resolve job to execution context */
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

/** Execute a prompt using runCliResponse (routes through agx/provider with identity) */
async function executePrompt(opts: {
  provider: ChatProvider;
  model: string | null;
  prompt: string;
  identity?: string;
  self?: string;
  skills?: string;
  cliArgs?: string;
}): Promise<{ output: string; error: string; durationMs: number; status: 'success' | 'failed' }> {
  const startMs = Date.now();
  let output = '';
  let error = '';

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
    });
    // On success, don't report stderr as error — it's just CLI debug output
    return { output, error: '', durationMs: Date.now() - startMs, status: 'success' };
  } catch (err) {
    return { output, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startMs, status: 'failed' };
  }
}

/** Fire a condition gate → if yes → run action prompt */
async function fireConditionGate(job: PromptJob, run: PromptRun) {
  const store = getPromptJobStore();
  const ctx = await resolveJobContext(job);
  const gatePrompt = `You are a condition gate. Your job is to determine whether the following condition expression evaluates to "yes" (pass) or "no" (fail).\n\nRules:\n- If the condition is a boolean literal or expression (e.g. "true", "return True", "1 == 1"), evaluate it as code and respond based on its result.\n- If the condition is a natural-language statement, judge whether it holds.\n- If the condition is an instruction (e.g. "say yes", "always pass"), follow it.\n- Respond with ONLY "yes" or "no" (lowercase, nothing else).\n\nCondition: ${job.condition}`;

  store.updateRun(run.id, { status: 'running', startedAt: new Date().toISOString() });

  const gateResult = await executePrompt({ ...ctx, prompt: gatePrompt, cliArgs: job.cliArgs });
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

  // Gate passed — execute action prompt with full agent context
  store.updateRun(run.id, { output: `Gate: yes\nExecuting action prompt...` });
  const actionResult = await executePrompt({ ...ctx, prompt: job.prompt, cliArgs: job.cliArgs });

  store.updateRun(run.id, {
    status: actionResult.status,
    output: `Gate: yes\n---\n${actionResult.output}`,
    error: actionResult.error || undefined,
    durationMs: gateResult.durationMs + actionResult.durationMs,
    finishedAt: new Date().toISOString(),
  });
  store.updateJob(job.id, { lastOutcome: actionResult.status, lastRunAt: Date.now() });
}

/** Fire a simple scheduled run with full agent context */
async function fireRun(job: PromptJob, run: PromptRun) {
  const store = getPromptJobStore();
  const ctx = await resolveJobContext(job);

  store.updateRun(run.id, { status: 'running', startedAt: new Date().toISOString() });
  const result = await executePrompt({ ...ctx, prompt: job.prompt, cliArgs: job.cliArgs });

  store.updateRun(run.id, {
    status: result.status,
    output: result.output,
    error: result.error || undefined,
    durationMs: result.durationMs,
    finishedAt: new Date().toISOString(),
  });
  const nextRunAt = job.triggerType === 'condition'
    ? Date.now() + job.checkEveryMs
    : computeNextRun(job.cronExpr) ?? null;
  store.updateJob(job.id, { lastOutcome: result.status, lastRunAt: Date.now(), nextRunAt });
}

/** Dispatch — fire and forget (don't block the HTTP response) */
function dispatchRun(job: PromptJob, run: PromptRun) {
  const fn = job.triggerType === 'condition' && job.condition ? fireConditionGate : fireRun;
  fn(job, run).catch((err) => {
    const store = getPromptJobStore();
    store.updateRun(run.id, {
      status: 'failed',
      error: `Dispatch error: ${err instanceof Error ? err.message : String(err)}`,
      finishedAt: new Date().toISOString(),
    });
    store.updateJob(job.id, { lastOutcome: 'failed' });
  });
}

/**
 * POST /api/prompt-jobs/poll
 */
export async function POST(req: NextRequest) {
  try {
    const store = getPromptJobStore();
    let body: { jobId?: string } = {};
    try { body = await req.json(); } catch {}

    if (body.jobId) {
      const job = store.getJob(body.jobId);
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      const run = store.createRun(job.id);
      dispatchRun(job, run);
      return NextResponse.json({ queued: [run], skipped: [] });
    }

    const result = pollDueJobs(store);
    for (const run of result.queued) {
      const job = store.getJob(run.jobId);
      if (!job) continue;
      dispatchRun(job, run);
    }

    return NextResponse.json({ queued: result.queued, skipped: result.skipped });
  } catch (error) {
    console.error('Failed to poll prompt jobs:', error);
    return NextResponse.json(
      { error: 'Failed to poll prompt jobs', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
