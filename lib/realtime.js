/**
 * RealtimeWorker - Supabase Realtime task execution daemon
 * 
 * Subscribes to Supabase Realtime for instant task dispatch (~100ms latency).
 * Executes tasks locally with user's API keys and engines.
 * Streams logs back to Supabase for aggregation.
 * 
 * Architecture:
 * - agx-cloud = control plane (queue, dashboard, logs)
 * - agx daemon --realtime = local execution via Supabase Realtime
 */

const { createClient } = require('@supabase/supabase-js');
const { executeTask } = require('./executor');

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
  magenta: '\x1b[35m',
};

class RealtimeWorker {
  constructor(config) {
    this.config = config;
    this.cloudUrl = config.apiUrl || 'http://localhost:3333';
    this.token = config.token;
    this.userId = config.userId;
    this.engine = config.engine || 'claude';
    
    // Supabase connection
    this.supabaseUrl = config.supabaseUrl;
    this.supabaseKey = config.supabaseKey; // anon key is fine for realtime
    this.supabase = null;
    this.channel = null;
    
    this.isRunning = false;
    this.currentTask = null;
    this.taskQueue = []; // Buffer for incoming tasks while processing
  }

  async start() {
    if (!this.supabaseUrl || !this.supabaseKey) {
      console.log(`${c.red}✗${c.reset} Supabase not configured.`);
      console.log(`${c.dim}  Run: agx cloud setup-realtime${c.reset}`);
      process.exit(1);
    }

    // Initialize Supabase client
    this.supabase = createClient(this.supabaseUrl, this.supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 10, // Rate limit
        },
      },
    });

    this.isRunning = true;

    console.log(`${c.green}🚀${c.reset} agx daemon running ${c.magenta}(realtime mode)${c.reset}`);
    console.log(`${c.dim}   Cloud: ${this.cloudUrl}${c.reset}`);
    console.log(`${c.dim}   Supabase: ${this.supabaseUrl}${c.reset}`);
    console.log(`${c.dim}   Engine: ${this.engine}${c.reset}`);
    console.log(`${c.dim}   User: ${this.userId || '(anonymous)'}${c.reset}\n`);

    // Subscribe to new tasks for this user
    this.channel = this.supabase
      .channel('my-tasks')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tasks',
          filter: this.userId ? `user_id=eq.${this.userId}` : undefined,
        },
        async (payload) => {
          const task = payload.new;
          console.log(`${c.cyan}📥${c.reset} New task: ${c.bold}${task.title || 'Untitled'}${c.reset}`);
          
          // Queue task for processing
          this.taskQueue.push(task);
          this.processQueue();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tasks',
          filter: this.userId ? `user_id=eq.${this.userId}` : undefined,
        },
        (payload) => {
          const task = payload.new;
          // Only log significant updates (stage changes, status changes)
          if (task.id !== this.currentTask?.id) {
            console.log(`${c.dim}[update] ${task.title} → ${task.stage} (${task.status})${c.reset}`);
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log(`${c.green}📡${c.reset} Connected to Supabase Realtime`);
          console.log(`${c.dim}   Waiting for tasks...${c.reset}\n`);
        } else if (status === 'CHANNEL_ERROR') {
          console.log(`${c.red}✗${c.reset} Realtime error: ${err?.message || 'Unknown error'}`);
        } else if (status === 'TIMED_OUT') {
          console.log(`${c.yellow}⚠${c.reset} Realtime connection timed out, reconnecting...`);
        } else if (status === 'CLOSED') {
          console.log(`${c.dim}📡 Realtime connection closed${c.reset}`);
        }
      });

    // Also poll once at startup to catch any queued tasks
    await this.pollOnce();
  }

  async pollOnce() {
    try {
      // Check for any queued tasks that may have been missed
      const { task } = await this.apiRequest('GET', `/api/queue?engine=${this.engine}`);
      if (task && task.status === 'queued') {
        console.log(`${c.cyan}📋${c.reset} Found queued task: ${c.bold}${task.title || 'Untitled'}${c.reset}`);
        this.taskQueue.push(task);
        this.processQueue();
      }
    } catch (err) {
      // Silent - just startup check
    }
  }

  async processQueue() {
    // Don't process if already working on something
    if (this.currentTask || this.taskQueue.length === 0) return;

    const task = this.taskQueue.shift();
    
    // Skip if task is no longer queued (someone else grabbed it)
    if (task.status !== 'queued' && task.status !== 'in_progress') {
      this.processQueue(); // Try next
      return;
    }

    await this.processTask(task);
    
    // Process next in queue
    this.processQueue();
  }

  async processTask(task) {
    const { id: taskId, title, content, stage, engine, project } = task;
    this.currentTask = task;

    const startTime = Date.now();
    const stageIcon = {
      ideation: '💡',
      coding: '💻',
      qa: '🧪',
      acceptance: '✓',
      deployment: '📦',
      smoke_test: '🔥',
      release: '📢',
      done: '✅',
    }[stage] || '▶';

    console.log(`\n${c.cyan}${stageIcon}${c.reset} [${stage}] ${c.bold}${title}${c.reset}`);
    if (project) console.log(`${c.dim}   Project: ${project}${c.reset}`);

    try {
      // Update status to in_progress via Supabase directly (faster than HTTP)
      await this.supabase
        .from('tasks')
        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', taskId);

      await this.pushLog(taskId, `[daemon] Started stage: ${stage} (engine: ${engine || this.engine})`);

      // Execute locally with user's configured engine
      const result = await executeTask({
        taskId,
        title,
        content,
        stage,
        engine: engine || this.engine,
        onLog: (log) => this.pushLog(taskId, log),
        onProgress: (p) => this.updateProgress(taskId, p),
      });

      // Advance to next stage
      const { newStage } = await this.advanceStage(taskId);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`${c.green}✓${c.reset} Done: ${title} ${c.dim}(${duration}s)${c.reset}`);

      if (newStage === 'done') {
        console.log(`   ${c.green}Task complete!${c.reset}`);
      } else {
        console.log(`   ${c.dim}→ Next stage: ${newStage}${c.reset}`);
      }

      return result;
    } catch (err) {
      console.error(`${c.red}✗${c.reset} Failed: ${title}`);
      console.error(`   ${c.dim}${err.message}${c.reset}`);

      await this.pushLog(taskId, `[daemon] Error: ${err.message}`);
      
      // Update status to blocked via Supabase
      await this.supabase
        .from('tasks')
        .update({ status: 'blocked', updated_at: new Date().toISOString() })
        .eq('id', taskId);
    } finally {
      this.currentTask = null;
    }
  }

  async stop() {
    this.isRunning = false;

    if (this.channel) {
      await this.supabase.removeChannel(this.channel);
      this.channel = null;
    }

    if (this.currentTask) {
      console.log(`${c.yellow}⏳${c.reset} Waiting for current task to finish...`);
      let waited = 0;
      while (this.currentTask && waited < 30000) {
        await new Promise((r) => setTimeout(r, 1000));
        waited += 1000;
      }
    }

    console.log(`${c.dim}⏹ agx daemon stopped${c.reset}`);
  }

  // Push logs via Supabase directly (faster than HTTP for streaming)
  async pushLog(taskId, content) {
    try {
      await this.supabase.from('task_logs').insert({
        task_id: taskId,
        content,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      // Fallback to HTTP if direct insert fails
      try {
        await this.apiRequest('POST', `/api/tasks/${taskId}/logs`, { content });
      } catch {
        console.error(`${c.dim}Failed to push log${c.reset}`);
      }
    }
  }

  async updateProgress(taskId, progress) {
    try {
      await this.supabase
        .from('tasks')
        .update({ progress, updated_at: new Date().toISOString() })
        .eq('id', taskId);
    } catch {
      // Silent - progress updates are optional
    }
  }

  async advanceStage(taskId) {
    // Use HTTP API for stage advancement (has business logic)
    return this.apiRequest('POST', `/api/tasks/${taskId}/advance`);
  }

  // HTTP API helper (for operations that need cloud business logic)
  async apiRequest(method, endpoint, body = null) {
    const url = `${this.cloudUrl}${endpoint}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
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
}

module.exports = { RealtimeWorker };
