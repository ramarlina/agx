<h1 align="center">
  <br>
  AGX
  <br>
</h1>

<h4 align="center">Chat with AI agents. Watch them plan. Approve before they act.</h4>

<p align="center">
  <br>
  <a href="https://github.com/ramarlina/agx">
    <img src="agx-chat-to-tasks.gif" alt="AGX" width="600">
  </a>
  <br>
  <br>
</p>

<p align="center">
  <a href="https://github.com/ramarlina/agx/stargazers">
    <img src="https://img.shields.io/github/stars/ramarlina/agx?style=social" alt="GitHub Stars">
  </a>
  <a href="https://www.npmjs.com/package/@mndrk/agx">
    <img src="https://img.shields.io/npm/v/@mndrk/agx?color=green" alt="NPM Version">
  </a>
  <a href="https://www.npmjs.com/package/@mndrk/agx">
    <img src="https://img.shields.io/npm/dm/@mndrk/agx" alt="NPM Downloads">
  </a>
  <a href="https://github.com/ramarlina/agx/commits/main">
    <img src="https://img.shields.io/github/last-commit/ramarlina/agx" alt="Last Commit">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License">
  </a>
  <a href="https://nodejs.org">
    <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg" alt="Node">
  </a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#commands">Commands</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#license">License</a>
</p>

---

> **TL;DR** — Drop an idea into a multi-agent chat. Let agents debate, plan, and structure the work. Push tasks to a board. Watch an execution graph run. Approve gates before anything critical happens. All local, all yours.

---

## Quick Start

```bash
npm install -g @mndrk/agx
cd my-project
agx init
```

### Start a multi-agent chat

```bash
agx chat
```

Drop an idea, @mention agents, let them plan. When ready, push tasks to the board.

### Run tasks autonomously

```bash
agx new "Refactor the authentication middleware"
agx daemon start
```

Open the board, watch the agent work, approve gates, stop/restart at will.

---

## Features

- **Multi-agent chat** — Talk to Claude, Codex, Gemini, or Ollama in the same thread. @mention agents, get multiple perspectives, steer the conversation.
- **Execution graphs** — Tasks run as dynamic graphs, not fixed linear stages. Branch, fork, join — the graph is a map of decisions, not a to-do list.
- **Human-in-the-loop gates** — Critical nodes pause for your explicit `approve` / `reject`. Agents do the heavy lifting; you stay in control.
- **Durable, resumable execution** — Tasks survive restarts, crashes, and reboots. State is checkpointed, not rebuilt from history.
- **Bundled dashboard (Kanban)** — Ships with the CLI. Chat is the thinking; board is the doing.
- **Multi-provider** — Claude, Codex, Gemini, Ollama. Use whatever fits.
- **Local & inspectable** — Runs entirely on your machine. Full execution logs, task signing, safeguards for destructive commands.

---

## What AGX is *not*

- Not just a chatbot
- Not a hosted SaaS
- Not prompt-replay-based
- Not a black-box agent framework

AGX is infrastructure for running agents **locally, durably, and observably**.

---

## Commands

### Chat

```bash
agx chat codex                 # New chat session
agx chat claude --task <id>    # Continue on an existing task
```

### Task Management

```bash
agx init                                        # Initialize AGX in current directory
agx new "<goal>"                                # Create a new task
agx run <task_id>                               # Run a specific task
agx status [task-id-or-slug]                    # Show status
agx retry <task_id-or-slug> [--from <stage>]    # Reset + retry
agx approve <task> [--node <node-id>] [-m "feedback"]  # Approve a gate
agx reject <task> [--node <node-id>] [-m "feedback"]   # Reject a gate
agx deps <task> [--depends-on <task> ... | --clear]    # Manage dependencies
```

### Board & Daemon

```bash
agx board start        # Start the dashboard
agx daemon start       # Start background worker
agx daemon stop        # Stop daemon and board
```

### One-Shot Mode

```bash
agx -p "Explain this error"
agx claude -p "Refactor this function"
agx codex -p "Propose a migration plan"
```

---

## Providers

| Provider | Alias | Command      |
| -------- | ----- | ------------ |
| Claude   | `c`   | `agx claude` |
| Codex    | `x`   | `agx codex`  |
| Gemini   | `g`   | `agx gemini` |
| Ollama   | `o`   | `agx ollama` |

---

## Key Flags

```bash
-p, --prompt        # Task goal
-P, --provider      # c | x | g | o
-m, --model         # Explicit model for provider commands
-a, --autonomous    # Create task + start daemon + run until done
-y, --yolo          # Skip confirmations during execution (implied by -a)
--swarm             # Multi-agent swarm execution mode
```

---

## Prerequisites

- **Node.js** >= 18
- **At least one AI provider CLI:**
  - [Claude Code](https://docs.anthropic.com/claude/docs/claude-cli)
  - [OpenAI Codex CLI](https://www.npmjs.com/package/@openai/codex)
  - [Gemini CLI](https://ai.google.dev/gemini-api/docs/cli)
  - [Ollama](https://ollama.ai/)

No external database required. AGX uses SQLite locally.

---

## How It Works

AGX treats agent memory as **durable state**, not conversation history.

Agents follow a **Wake → Work → Sleep** cycle:

1. **Wake** — Load full context from checkpointed state
2. **Work** — Execute commands, edit files, validate output
3. **Sleep** — Checkpoint state and yield, ready to resume

Resuming a task is a constant-cost operation, no matter how long it has been running.

### Architecture

```
┌──────────────┐   ┌──────────────┐   ┌────────────┐
│ AGX Board    │◄─►│ SQLite       │◄─►│ Task Queue │
│ (Next.js)    │   │ Durable State│   │            │
└──────────────┘   └──────────────┘   └────────────┘

┌──────────────┐   ┌──────────────┐   ┌────────────┐
│ AI Provider  │◄─►│ AGX CLI      │◄─►│ AGX Daemon │
│ C/Codex/G/O  │   │              │   │            │
└──────────────┘   └──────────────┘   └────────────┘
```

- **State layer** — SQLite (WAL mode), durable checkpoints, task queueing
- **Execution layer** — CLI + daemon, provider tool calls, filesystem edits
- **Decision layer** — Execution graph runtime + human gate transitions

---

## Tech Stack

* **Frontend:** Next.js, Tailwind CSS
* **Database:** SQLite (WAL mode)
* **Runtime:** Node.js (TypeScript / `tsx`)
* **Streaming:** EventSource (CLI → board)

---

## Contributing

Contributions welcome.

* **Ideas & questions:** GitHub Discussions
* **Bugs & features:** GitHub Issues
* **PRs:** Fork `main`, add tests, submit

---

## Telemetry

**Telemetry is enabled by default.**

AGX collects anonymous usage data to improve the tool. Here's exactly what we collect:

| Data | Example |
|------|---------|
| OS & architecture | `darwin`, `arm64` |
| Node.js version | `v20.10.0` |
| AGX version | `1.4.55` |
| Commands run | `new`, `daemon start` |
| Provider used | `claude`, `codex`, `gemini`, `ollama` |
| Task outcomes | `completed`, `failed` |
| Timing | `duration_ms: 12345` |

**We do NOT collect:** prompts, code, API keys, file paths, or any PII.

### Disable telemetry

```bash
agx telemetry off
# or: export AGX_TELEMETRY=0
# or: ~/.agx/config.json → { "telemetry": { "enabled": false } }
```

---

## License

MIT

---

<p align="center">
  <strong>Not a chatbot. An execution engine.</strong>
</p>
