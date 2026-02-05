/**
 * AgxWorker - Local task execution daemon
 * 
 * Pulls tasks from agx-cloud via HTTP polling.
 * Executes tasks locally with user's API keys and engines.
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

const { executeTask } = require('./executor');
const { 
  securityCheck, 
  confirmDangerousOperation, 
  logTaskExecution,
  getDaemonSecret,
} = require('./security');

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

class AgxWorker {
  constructor(config) {
    this.config = config;
    this.cloudUrl = config.apiUrl || 'http://localhost:3333';
    this.token = config.token;
    this.engine = config.engine || 'claude';
    this.pollIntervalMs = config.pollIntervalMs || 10000; // 10 seconds
    
    // Security settings
    this.security = {
      requireSignature: config.security?.requireSignature ?? true,
      allowDangerous: config.security?.allowDangerous ?? false,
      interactive: process.stdin.isTTY ?? false,
    };
    
    this.isRunning = false;
    this.currentTask = null;
    this.pollTimer = null;
  }

  async start() {
    this.isRunning = true;
    
    console.log(`${c.green}🚀${c.reset} agx daemon running (local execution)`);
    console.log(`${c.dim}   Cloud: ${this.cloudUrl}${c.reset}`);
    console.log(`${c.dim}   Engine: ${this.engine}${c.reset}`);
    console.log(`${c.dim}   Poll: every ${this.pollIntervalMs / 1000}s${c.reset}`);
    
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

    // Start polling loop
    await this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  async poll() {
    if (!this.isRunning || this.currentTask) return;

    try {
      // Pull next task from cloud queue
      const { task } = await this.apiRequest('GET', `/api/queue?engine=${this.engine}`);
      
      if (task) {
        await this.processTask(task);
      }
    } catch (err) {
      // Silent on network errors, just retry next poll
      if (!err.message.includes('fetch')) {
        console.error(`${c.dim}Poll error: ${err.message}${c.reset}`);
      }
    }
  }

  async processTask(task) {
    const { id: taskId, title, content, stage, engine, project, signature } = task;
    this.currentTask = task;
    
    const startTime = Date.now();
    const stageIcon = {
      ideation: '💡',
      planning: '📋',
      coding: '💻',
      qa: '🧪',
      acceptance: '✓',
      deployment: '📦',
      smoke_test: '🔥',
      release: '📢',
      done: '✅',
    }[stage] || '▶';

    console.log(`${c.cyan}${stageIcon}${c.reset} [${stage}] ${c.bold}${title}${c.reset}`);
    if (project) console.log(`${c.dim}   Project: ${project}${c.reset}`);

    // ========== SECURITY CHECKS ==========
    try {
      const check = await securityCheck(task, {
        requireSignature: this.security.requireSignature,
        allowDangerous: this.security.allowDangerous,
        interactive: this.security.interactive,
      });

      // Log the security check
      if (!check.canExecute) {
        console.log(`${c.red}🚫${c.reset} ${check.reason}`);
        logTaskExecution(task, {
          action: 'reject',
          result: 'rejected',
          signatureValid: check.signatureValid,
          dangerousOps: check.dangerousOps,
          skipped: true,
          error: check.reason,
        });
        await this.pushLog(taskId, `[daemon] REJECTED: ${check.reason}`);
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
        const confirmed = await confirmDangerousOperation(task, check.dangerousOps);
        if (!confirmed) {
          console.log(`${c.yellow}⏭${c.reset} Skipped by user\n`);
          logTaskExecution(task, {
            action: 'skip',
            result: 'skipped',
            signatureValid: check.signatureValid,
            dangerousOps: check.dangerousOps,
            skipped: true,
          });
          await this.pushLog(taskId, `[daemon] Skipped by user (dangerous operations)`);
          return;
        }
        console.log(`${c.green}✓${c.reset} User confirmed dangerous operation\n`);
      }

      // Log execution start
      logTaskExecution(task, {
        action: 'execute',
        result: 'pending',
        signatureValid: check.signatureValid,
        dangerousOps: check.dangerousOps,
      });

      await this.pushLog(taskId, `[daemon] Started stage: ${stage} (engine: ${engine || this.engine})`);

      // ========== EXECUTE TASK ==========
      const result = await executeTask({
        taskId,
        title,
        content,
        stage,
        engine: engine || this.engine,
        onLog: (log) => this.pushLog(taskId, log),
        onProgress: (p) => this.updateProgress(taskId, p),
      });

      // Advance to next stage via cloud API
      const { newStage } = await this.advanceStage(taskId);
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`${c.green}✓${c.reset} Done: ${title} ${c.dim}(${duration}s)${c.reset}`);
      
      // Log successful completion
      logTaskExecution(task, {
        action: 'complete',
        result: 'success',
        signatureValid: check.signatureValid,
        dangerousOps: check.dangerousOps,
      });

      if (newStage === 'done') {
        console.log(`   ${c.green}Task complete!${c.reset}\n`);
      } else {
        console.log(`   ${c.dim}→ Next stage: ${newStage}${c.reset}\n`);
      }

      return result;
    } catch (err) {
      console.error(`${c.red}✗${c.reset} Failed: ${title}`);
      console.error(`   ${c.dim}${err.message}${c.reset}\n`);
      
      // Log failure
      logTaskExecution(task, {
        action: 'execute',
        result: 'failed',
        error: err.message,
      });
      
      await this.pushLog(taskId, `[daemon] Error: ${err.message}`);
      await this.updateTaskStatus(taskId, 'blocked');
    } finally {
      this.currentTask = null;
    }
  }

  async stop() {
    this.isRunning = false;
    
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
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
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async pushLog(taskId, log) {
    try {
      return await this.apiRequest('POST', `/api/tasks/${taskId}/logs`, { content: log });
    } catch (err) {
      console.error(`${c.dim}Failed to push log: ${err.message}${c.reset}`);
    }
  }

  async updateProgress(taskId, progress) {
    try {
      return await this.apiRequest('PATCH', `/api/tasks/${taskId}`, { progress });
    } catch (err) {
      // Silent - progress updates are optional
    }
  }

  async advanceStage(taskId) {
    return this.apiRequest('POST', `/api/tasks/${taskId}/advance`);
  }

  async updateTaskStatus(taskId, status) {
    return this.apiRequest('PATCH', `/api/tasks/${taskId}`, { status });
  }
}

module.exports = { AgxWorker };
