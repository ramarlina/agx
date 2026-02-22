/* eslint-disable no-console */
'use strict';

const readline = require('readline');
const execa = require('execa');
const { c } = require('../../ui/colors');
const { createCloudClient } = require('../../cloud/client');
const { loadConfig, prompt: cliPrompt } = require('../configStore');
const { detectProviders } = require('../providers');
const { truncateForComment } = require('../../ui/text');
const { randomId } = require('../util');

class ChatSession {
  constructor(options = {}) {
    this.provider = options.provider || null;
    this.model = options.model || null;
    this.taskId = options.taskId || null;
    this.cloudClient = createCloudClient({ configDir: options.configDir });
    this.history = [];
    this.rl = null;
  }

  async init() {
    const config = loadConfig();
    const providers = detectProviders();

    if (!this.provider || !providers[this.provider]) {
      // Use configured default, then fall back to detection
      if (config?.defaultProvider && providers[config.defaultProvider]) this.provider = config.defaultProvider;
      else if (providers.claude) this.provider = 'claude';
      else if (providers.gemini) this.provider = 'gemini';
      else if (providers.ollama) this.provider = 'ollama';
      else if (providers.codex) this.provider = 'codex';
      else {
        console.log(`${c.red}No AI provider found.${c.reset}`);
        return false;
      }
    }

    if (!this.taskId) {
      // Create a new task for this chat session
      await this.createChatTask();
    } else {
      // Load existing task context
      await this.loadTaskContext();
    }

    return true;
  }

  async createChatTask() {
    const title = `Chat Session ${new Date().toLocaleTimeString()}`;
    console.log(`${c.dim}Creating chat session...${c.reset}`);
    
    try {
      const { task } = await this.cloudClient.request('POST', '/api/tasks', {
        content: `---\nstatus: in_progress\nstage: chat\nengine: ${this.provider}\ntype: chat\n---\n\n# ${title}\n\nInteractive chat session started via CLI.\n`
      });
      this.taskId = task.id;
      console.log(`${c.green}✓${c.reset} Session started (${task.id.slice(0, 8)})`);
    } catch (err) {
      console.log(`${c.red}Failed to create session:${c.reset} ${err.message}`);
      throw err;
    }
  }

  async loadTaskContext() {
    // Load history from comments
    try {
      const { comments } = await this.cloudClient.request('GET', `/api/tasks/${this.taskId}/comments`);
      if (comments && comments.length) {
        // Replay history
        for (const comment of comments) {
           const author = comment.author_type === 'user' ? 'You' : 'Agent';
           const color = author === 'You' ? c.cyan : c.green;
           console.log(`
${color}${author}:${c.reset} ${comment.content}`);
        }
      }
    } catch (err) {
      // Ignore
    }
  }

  async start() {
    console.log(`
${c.bold}Chat with ${this.provider}${c.reset}`);
    console.log(`${c.dim}Type 'exit' or 'quit' to end session.${c.reset}\n`);

    return new Promise((resolve) => {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${c.cyan}You:${c.reset} `
      });

      this.rl.prompt();

      this.rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) {
          this.rl.prompt();
          return;
        }

        if (['exit', 'quit', '/exit', '/quit'].includes(input.toLowerCase())) {
          this.rl.close();
          return;
        }

        // Save user message
        await this.postComment(input, 'user');

        // Run agent
        process.stdout.write(`${c.green}Agent:${c.reset} `);
        const response = await this.runAgent(input);
        
        // Save agent response
        if (response) {
          await this.postComment(response, 'assistant');
          console.log(''); // Newline after response
        }

        this.rl.prompt();
      });

      this.rl.on('close', () => {
        console.log(`
${c.dim}Session ended.${c.reset}`);
        resolve();
      });
    });
  }

  async postComment(content, authorType = 'user') {
    try {
      await this.cloudClient.request('POST', `/api/tasks/${this.taskId}/comments`, {
        content: truncateForComment(content),
        author_type: authorType
      });
    } catch (err) {
      // Silent fail on history save
    }
  }

  async runAgent(input) {
    // We invoke `agx <provider>` with the task context.
    // The task context includes previous comments, so the agent sees history.
    // We pass the *current* input as the prompt as well, to ensure immediate attention.
    
    // Construct command
    // We use the same arguments structure as runCli uses for providers
    const args = [this.provider, '--cloud-task', this.taskId, '-p', input, '-y'];
    if (this.model) {
      args.push('--model', this.model);
    }

    try {
      // Spawn agx (self) to handle the provider call with context loading
      // This reuses all the prompt building logic in runCli.js
      const child = execa(process.argv[0], [process.argv[1], ...args], {
        env: { ...process.env, AGX_CLI_CHAT_MODE: '1' },
        reject: false
      });

      let output = '';
      
      if (child.stdout) {
        child.stdout.on('data', (d) => {
          const chunk = d.toString();
          output += chunk;
          process.stdout.write(chunk);
        });
      }
      
      if (child.stderr) {
         // Log stderr but maybe not to user unless debug?
         // child.stderr.pipe(process.stderr);
      }

      const res = await child;
      
      if (res.exitCode !== 0) {
        console.log(`${c.red} (Error: Agent exited with code ${res.exitCode})${c.reset}`);
        return null;
      }

      return output;
    } catch (err) {
      console.log(`${c.red} (Error running agent: ${err.message})${c.reset}`);
      return null;
    }
  }
}

async function startChat(options) {
  const session = new ChatSession(options);
  if (await session.init()) {
    await session.start();
  }
}

module.exports = { startChat, ChatSession };