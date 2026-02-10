<h1 align="center">
  <br>
  AGX
  <br>
</h1>

<h4 align="center">Local-first agent orchestrator with durable state and visual control.</h4>

<p align="center">
  <br>
  <a href="https://github.com/ramarlina/agx">
    <img src="agx_dashboard.png" alt="AGX" width="600">
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
  <a href="#why-agx-exists">Why AGX</a> •
  <a href="#features">Features</a> •
  <a href="#commands">Commands</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  AGX turns AI coding CLIs (Claude Code, Gemini CLI, Ollama) into autonomous agents that persist across sessions, survive crashes, and run unattended. Instead of reconstructing context from chat history, AGX stores <strong>authoritative agent state locally in PostgreSQL</strong>.
</p>

---

## Why AGX exists

Most agent tools treat "memory" as conversation history.

AGX treats memory as **durable state**.

Agents follow a **Wake → Work → Sleep** cycle:

1. **Wake** — Load full context from durable state (not rebuilt from history)
2. **Work** — Execute commands, edit files, validate output
3. **Sleep** — Checkpoint state and yield, ready to resume

AGX separates **execution state** from **execution history**:

- **State (hot):** current context, working set, checkpoints
- **History (cold):** logs, artifacts, audit trail

History is never replayed to rebuild context.
Resuming a task is a constant-cost operation, no matter how long it has been running.

---

## Features

- **Durable, resumable execution** — Tasks survive restarts, crashes, and machine reboots. State is checkpointed after every agent iteration.
- **Bundled dashboard (Kanban)** — Ships with the CLI. Reflects authoritative database state.
- **Multi-provider** — Use Claude, Gemini, or Ollama depending on your needs.
- **Local & inspectable** — Runs entirely on your machine. Safeguards for destructive commands, task signing, and full execution logs.
- **Project workflows** — Define custom SDLC stage prompts (Planning, Coding, QA, etc.) tailored to your repository.

---

## What AGX is *not*

- Not a chat UI
- Not a hosted SaaS
- Not prompt-replay–based
- Not a black-box agent framework

AGX is infrastructure for running agents **locally, durably, and observably**.

---

## Quick Start

### Installation

```bash
npm install -g @mndrk/agx
```

### 90-second demo

```bash
cd my-project
agx init
agx new "Refactor the authentication middleware"
agx daemon start
```

Open the board, watch the agent work, stop/restart at will.

---

## Prerequisites

- **PostgreSQL** — Used for durable state and task queueing. AGX can auto-start Postgres via Docker if none is running.
- **At least one AI provider CLI:**
  - [Claude Code](https://docs.anthropic.com/claude/docs/claude-cli)
  - [Gemini CLI](https://ai.google.dev/gemini-api/docs/cli)
  - [Ollama](https://ollama.ai/)

No manual database setup required.

---

## Commands

### Task Management

```bash
agx init               # Initialize AGX in current directory
agx new "<goal>"       # Create a new task
agx run <task_id>      # Run a specific task
agx status             # Show current status
```

### Board Server

```bash
agx board start
agx board stop
agx board status
agx board logs
agx board tail
```

### Daemon Mode

```bash
agx daemon start       # Start background worker
agx daemon stop        # Stop daemon and board
agx daemon status
```

### One-Shot Mode

```bash
agx -p "Explain this error"
agx claude -p "Refactor this function"
agx gemini -p "Debug this code"
```

---

## Providers

| Provider | Alias | Command      |
| -------- | ----- | ------------ |
| Claude   | `c`   | `agx claude` |
| Gemini   | `g`   | `agx gemini` |
| Ollama   | `o`   | `agx ollama` |

---

## Key Flags

```bash
-a, --autonomous    # Create task + start daemon + run until done
-p, --prompt        # Task goal
-y, --yolo          # Skip confirmations
-P, --provider      # c | g | o
```

---

## Architecture

AGX uses a split-plane architecture — all local.

```
Control Plane (State & Orchestration)
┌──────────────┐   ┌──────────────┐   ┌────────────┐
│ AGX Board    │◄─►│ PostgreSQL   │◄─►│ pg-boss    │
│ (Next.js)    │   │ Durable State│   │ Task Queue │
└──────────────┘   └──────────────┘   └────────────┘

Data Plane (Execution)
┌──────────────┐   ┌──────────────┐   ┌────────────┐
│ AI Provider  │◄─►│ AGX CLI      │◄─►│ AGX Daemon │
│ Claude/Gemini│   │              │   │            │
└──────────────┘   └──────────────┘   └────────────┘
```

* **Control Plane** — authoritative state, workflows, monitoring
* **Data Plane** — execution, tool calls, filesystem edits

---

## Tech Stack

* **Frontend:** Next.js, Tailwind CSS
* **Database:** PostgreSQL + `pg-boss`
* **Runtime:** Node.js (TypeScript / `tsx`)
* **Streaming:** EventSource (CLI → board)

---

## Contributing

Contributions welcome.

* **Ideas & questions:** GitHub Discussions
* **Bugs & features:** GitHub Issues
* **PRs:** Fork `main`, add tests, submit

---

## License

MIT

---

<p align="center">
  <br>
  ⭐ <strong>Star This Project</strong><br>
  If AGX helps you build better software with AI agents, please give us a star! It helps others discover the project and motivates us to keep improving.
</p>

---

<p align="center">
  <strong>Built for autonomous agents</strong> · <strong>Powered by durable state</strong> · <strong>Made with TypeScript</strong>
</p>
