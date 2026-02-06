/**
 * AgxWorker - Local task execution daemon
 * 
 * Subscribes to tasks from agx-cloud via Supabase Realtime.
 * Executes tasks locally with user's API keys.
 * Streams logs back to cloud for aggregation.
 * 
 * Architecture:
 * - agx-cloud = control plane (queue, dashboard, logs)
 * - agx daemon = local execution (user's machine, user's keys)
 * 
 * Security features:
 * - Task signature verification (HMAC-SHA256)
 * - Dangerous operation detection + confirmation
 * - Local audit logging
 */

const path = require('path');
const { spawn } = require('child_process');
const {
  securityCheck,
  confirmDangerousOperation,
  logTaskExecution,
  getDaemonSecret,
} = require('./security');
const { createClient } = require('@supabase/supabase-js');

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function inferLogType(content) {
  if (!content) return 'system';
  const normalized = String(content).trim().toLowerCase();
  if (normalized.startsWith('[checkpoint]')) return 'checkpoint';
  if (normalized.startsWith('[blocked]')) return 'error';
  if (normalized.startsWith('[error]')) return 'error';
  if (normalized.startsWith('[daemon]') || normalized.startsWith('[system]')) return 'system';
  if (normalized.startsWith('[learning]')) return 'system';
  if (normalized.startsWith('[done]')) return 'system';
  if (normalized.startsWith('[progress]')) return 'system';
  if (normalized.startsWith('[agent]') || normalized.startsWith('[claude]') || normalized.startsWith('[gemini]') || normalized.startsWith('[ollama]')) {
    return 'system';
  }
  return 'system';
}

function isClaimConflictError(err) {
  const message = String(err?.message || err || '').toLowerCase();
  return message.includes('task already claimed')
    || message.includes('already claimed');
}

class AgxWorker {
  constructor(config) {
    this.config = config;
    this.cloudUrl = config.apiUrl || 'http://localhost:3333';
    this.token = config.token;
    this.pollIntervalMs = config.pollIntervalMs || 10000;

    this.supabaseUrl = config.supabaseUrl;
    this.supabaseKey = config.supabaseKey;
    this.realtimeEnabled = Boolean(this.supabaseUrl && this.supabaseKey);
    this.supabase = this.realtimeEnabled ? createClient(this.supabaseUrl, this.supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      }
    }) : null;
    this.streamChannels = new Map();

    // Security settings
    this.security = {
      requireSignature: config.security?.requireSignature ?? true,
      allowDangerous: config.security?.allowDangerous ?? false,
      interactive: process.stdin.isTTY ?? false,
    };

    this.isRunning = false;
    this.currentTask = null;
    this.realtimeChannel = null;
    this.pollTimer = null;
  }

  async start() {
    this.isRunning = true;

    console.log(`${c.green}🚀${c.reset} agx daemon running${this.realtimeEnabled ? ' (Realtime Swarm Mode)' : ' (Polling Mode)'}`);
    console.log(`${c.dim}   Cloud: ${this.cloudUrl}${c.reset}`);
    if (this.realtimeEnabled) {
      console.log(`${c.dim}   Supabase: ${this.supabaseUrl}${c.reset}`);
    }

    // Check for daemon secret
    const secret = getDaemonSecret();
    if (secret) {
      console.log(`${c.dim}   Security: ✓ Daemon secret configured${c.reset}`);
      if (this.security.requireSignature) {
        console.log(`${c.dim}   Signature: Required (unsigned tasks will warn)${c.reset}`);
      }
    } else {
      console.log(`${c.yellow}   ⚠ No daemon secret - task signatures won't be verified${c.reset}`);
      console.log(`${c.dim}   Run: agx cloud login to configure${c.reset}`);
      this.security.requireSignature = false; // Can't verify without secret
    }

    if (!this.security.allowDangerous) {
      console.log(`${c.dim}   Dangerous ops: Will prompt for confirmation${c.reset}`);
    }

    console.log('');

    if (this.realtimeEnabled) {
      await this.subscribeToQueue();
    } else {
      await this.startPolling();
    }
  }

  async subscribeToQueue() {
    console.log(`${c.cyan}📡${c.reset} Subscribing to task queue...`);

    // Subscribe to INSERT events on 'tasks' where status=queued
    this.realtimeChannel = this.supabase
      .channel('daemon-queue')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tasks',
          filter: `status=eq.queued`,
        },
        async (payload) => {
          if (!this.isRunning) return;

          const task = payload.new;
          console.log(`${c.dim}🔔 New task detected: ${task.id}${c.reset}`);
          await this.tryClaimAndExecute(task);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`${c.green}✓${c.reset} Connected to Realtime Swarm`);
        } else if (status === 'CLOSED') {
          console.log(`${c.yellow}⚠${c.reset} Disconnected from Realtime`);
        }
      });

    // Also do an initial poll to pick up any existing tasks
    await this.pollOnce();
  }

  async startPolling() {
    console.log(`${c.cyan}📡${c.reset} Polling task queue...`);
    await this.pollOnce();
    this.pollTimer = setInterval(() => {
      this.pollOnce().catch(() => {});
    }, this.pollIntervalMs);
  }

  async pollOnce() {
    if (!this.isRunning || this.currentTask) return;
    // Pull one task to check if anything was pending while offline
    try {
      const { task } = await this.apiRequest('GET', `/api/queue`);
      if (task) {
        await this.tryClaimAndExecute(task);
      }
    } catch (e) { }
  }

  async tryClaimAndExecute(task) {
    if (this.currentTask) {
      console.log(`${c.dim}Busy, ignoring task ${task.id}${c.reset}`);
      return;
    }

    // Delegate execution to the same code path as `agx run <taskId>`.
    // The run command performs claim + execution + completion semantics.
    await this.processTask(task);
  }

  async processTask(task) {
    const { id: taskId, title, stage, project } = task;
    this.currentTask = task;

    // Queue payloads can be partial; verify signatures against canonical task data.
    let taskForSecurity = task;
    try {
      const { task: freshTask } = await this.apiRequest('GET', `/api/tasks/${taskId}`);
      if (freshTask && typeof freshTask === 'object') {
        taskForSecurity = freshTask;
      }
    } catch {
      // Best-effort: continue with queue payload if fetch fails.
    }
    const signature = taskForSecurity?.signature;

    const startTime = Date.now();
    const stageIcon = {
      ideation: '💡',
      planning: '📋',
      coding: '💻',
      qa: '🧪',
      acceptance: '✓',
      pr: '🔀',
      pr_review: '👀',
      merge: '🚀',
      done: '✅',
    }[stage] || '▶';

    console.log(`${c.cyan}${stageIcon}${c.reset} [${stage}] ${c.bold}${title}${c.reset}`);
    if (project) console.log(`${c.dim}   Project: ${project}${c.reset}`);

    // ========== SECURITY CHECKS ==========
    try {
      const check = await securityCheck(taskForSecurity, {
        requireSignature: this.security.requireSignature,
        allowDangerous: this.security.allowDangerous,
        interactive: this.security.interactive,
      });

      // Log the security check
      if (!check.canExecute) {
        console.log(`${c.red}🚫${c.reset} ${check.reason}`);
        logTaskExecution(taskForSecurity, {
          action: 'reject',
          result: 'rejected',
          signatureValid: check.signatureValid,
          dangerousOps: check.dangerousOps,
          skipped: true,
          error: check.reason,
        });
        await this.pushLog(taskId, `[daemon] REJECTED: ${check.reason}`, 'system');
        await this.updateTaskStatus(taskId, 'blocked');
        return;
      }

      // Show signature status
      if (check.signatureValid === true) {
        console.log(`${c.dim}   ✓ Signature verified${c.reset}`);
      } else if (check.signatureValid === false) {
        console.log(`${c.yellow}   ⚠ Invalid signature${c.reset}`);
      } else if (signature) {
        console.log(`${c.dim}   - Unsigned task${c.reset}`);
      }

      // Handle dangerous operations requiring confirmation
      if (check.requiresConfirmation && check.dangerousOps?.isDangerous) {
        const confirmed = await confirmDangerousOperation(taskForSecurity, check.dangerousOps);
        if (!confirmed) {
          console.log(`${c.yellow}⏭${c.reset} Skipped by user\n`);
          logTaskExecution(taskForSecurity, {
            action: 'skip',
            result: 'skipped',
            signatureValid: check.signatureValid,
            dangerousOps: check.dangerousOps,
            skipped: true,
          });
          await this.pushLog(taskId, `[daemon] Skipped by user (dangerous operations)`, 'system');
          await this.updateTaskStatus(taskId, 'blocked');
          return;
        }
        console.log(`${c.green}✓${c.reset} User confirmed dangerous operation\n`);
      }

      // Log execution start
      logTaskExecution(taskForSecurity, {
        action: 'execute',
        result: 'pending',
        signatureValid: check.signatureValid,
        dangerousOps: check.dangerousOps,
      });

      await this.pushLog(taskId, `[daemon] Started stage: ${stage}`, 'system');

      // ========== EXECUTE TASK ==========
      // Reuse `agx run` flow so daemon and manual runs share one execution path.
      const result = await this.executeViaRunCommand(taskId);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`${c.green}✓${c.reset} Done: ${title} ${c.dim}(${duration}s)${c.reset}`);

      // Log successful completion
      logTaskExecution(taskForSecurity, {
        action: 'complete',
        result: 'success',
        signatureValid: check.signatureValid,
        dangerousOps: check.dangerousOps,
        skipped: false
      });

      console.log(`   ${c.dim}Completed via shared run path${c.reset}\n`);

      if (result?.output) {
        await this.pushLog(taskId, result.output, 'output');
      }

      return result;
    } catch (err) {
      if (isClaimConflictError(err)) {
        console.log(`${c.yellow}⏭${c.reset} Skipped: task already claimed by another worker\n`);
        logTaskExecution(taskForSecurity, {
          action: 'skip',
          result: 'skipped',
          signatureValid: null,
          dangerousOps: null,
          skipped: true,
          error: err.message,
        });
        await this.pushLog(taskId, `[daemon] Skipped: task already claimed by another worker`, 'system');
        return;
      }

      console.error(`${c.red}✗${c.reset} Failed: ${title}`);
      console.error(`   ${c.dim}${err.message}${c.reset}\n`);

      // Log failure
      logTaskExecution(taskForSecurity, {
        action: 'execute',
        result: 'failed',
        error: err.message,
      });

      await this.pushLog(taskId, `[daemon] Error: ${err.message}`, 'error');
      await this.updateTaskStatus(taskId, 'blocked');
    } finally {
      await this.closeStreamChannel(taskId);
      this.currentTask = null;
    }
  }

  async executeViaRunCommand(taskId) {
    const agxEntry = path.resolve(__dirname, '..', 'index.js');
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [agxEntry, 'run', String(taskId)], {
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        this.pushStream(taskId, chunk);
      });

      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        this.pushStream(taskId, chunk);
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to start agx run: ${err.message}`));
      });

      child.on('close', (code) => {
        const combined = `${stdout}\n${stderr}`.trim();
        if (code === 0) {
          resolve({ output: combined });
          return;
        }
        reject(new Error(combined || `agx run exited with code ${code}`));
      });
    });
  }

  async stop() {
    this.isRunning = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.realtimeChannel) {
      await this.supabase.removeChannel(this.realtimeChannel);
    }
    if (this.streamChannels.size > 0) {
      for (const channel of this.streamChannels.values()) {
        await this.supabase.removeChannel(channel);
      }
      this.streamChannels.clear();
    }

    if (this.currentTask) {
      console.log(`${c.yellow}⏳${c.reset} Waiting for current task to finish...`);
      // Wait for current task (max 30s)
      let waited = 0;
      while (this.currentTask && waited < 30000) {
        await new Promise(r => setTimeout(r, 1000));
        waited += 1000;
      }
    }

    console.log(`${c.dim}⏹ agx daemon stopped${c.reset}`);
  }

  // API helpers - all communication with cloud
  async apiRequest(method, endpoint, body = null) {
    const url = `${this.cloudUrl}${endpoint}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    // Handle 409 Conflict specifically for claim
    if (response.status === 409 && endpoint.includes('/claim')) {
      return response.json(); // pass back error to caller
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async pushLog(taskId, log, logType) {
    try {
      const normalizedType = logType || inferLogType(log);
      return await this.apiRequest('POST', `/api/tasks/${taskId}/logs`, { content: log, log_type: normalizedType });
    } catch (err) {
      console.error(`${c.dim}Failed to push log: ${err.message}${c.reset}`);
    }
  }

  async pushStream(taskId, chunk) {
    if (!this.realtimeEnabled || !chunk) return;
    try {
      const channel = await this.getStreamChannel(taskId);
      if (!channel) return;
      await channel.send({
        type: 'broadcast',
        event: 'stream',
        payload: { taskId, chunk, ts: Date.now() }
      });
    } catch (err) {
      console.error(`${c.dim}Failed to stream log: ${err.message}${c.reset}`);
    }
  }

  async getStreamChannel(taskId) {
    if (!this.realtimeEnabled) return null;
    if (this.streamChannels.has(taskId)) {
      return this.streamChannels.get(taskId);
    }
    const channel = this.supabase.channel(`task-stream-${taskId}`, {
      config: {
        broadcast: { self: false }
      }
    });
    await channel.subscribe();
    this.streamChannels.set(taskId, channel);
    return channel;
  }

  async closeStreamChannel(taskId) {
    if (!this.realtimeEnabled) return;
    const channel = this.streamChannels.get(taskId);
    if (!channel) return;
    await this.supabase.removeChannel(channel);
    this.streamChannels.delete(taskId);
  }

  async updateProgress(taskId, progress) {
    try {
      return await this.apiRequest('PATCH', `/api/tasks/${taskId}`, { progress });
    } catch (err) {
      // Silent - progress updates are optional
    }
  }

  async advanceStage(taskId) {
    const advanceResult = await this.apiRequest('POST', `/api/tasks/${taskId}/advance`);
    await this.releaseClaim(taskId);
    return advanceResult;
  }

  async updateTaskStatus(taskId, status) {
    return this.apiRequest('PATCH', `/api/tasks/${taskId}`, { status });
  }

  async releaseClaim(taskId) {
    try {
      await this.apiRequest('PATCH', `/api/tasks/${taskId}`, {
        claimed_by: null,
        claimed_at: null,
      });
    } catch {
      // Best-effort cleanup; don't fail stage progression if claim release fails.
    }
  }
}

module.exports = { AgxWorker };
