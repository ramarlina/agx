# AGX

[![GitHub stars](https://img.shields.io/github/stars/ramarlina/agx?style=social)](https://github.com/ramarlina/agx)

**Local-first agent orchestrator with durable state and visual control.**

AGX turns AI coding CLIs (Claude Code, Gemini CLI, Ollama) into autonomous agents that persist across sessions, survive crashes, and run unattended.

Instead of reconstructing context from chat history, AGX stores **authoritative agent state locally in PostgreSQL**.
If a process dies mid-task, AGX resumes from the **last checkpoint** — not from replayed logs, not from rebuilt prompts.

- The **CLI** runs agents.
- The bundled **dashboard** shows live state from the database.
- If the dashboard stops, agents keep working.

![AGX Dashboard](agx_dashboard.png)

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

This single design choice is what makes long-running, multi-session agent execution reliable.

---

## Features

- **Durable, resumable execution**
  Tasks survive restarts, crashes, and machine reboots. State is checkpointed after every agent iteration.

- **Bundled dashboard (Kanban)**
  Ships with the CLI. Reflects authoritative database state — it does not maintain its own copy.

- **Multi-provider**
  Use Claude, Gemini, or Ollama depending on your needs.

- **Local & inspectable**
  Runs entirely on your machine. Safeguards for destructive commands (`rm -rf` protection), task signing, and full execution logs.

- **Project workflows**
  Define custom SDLC stage prompts (Planning, Coding, QA, etc.) tailored to your repository.

---

## What AGX is *not*

- Not a chat UI
- Not a hosted SaaS
- Not prompt-replay–based
- Not a black-box agent framework

AGX is infrastructure for running agents **locally, durably, and observably**.

---

## Prerequisites

AGX manages its own infrastructure.

- **PostgreSQL**
  Used for durable state and task queueing.
  AGX can auto-start Postgres via Docker if none is running.

- **At least one AI provider CLI**
  - [Claude Code](https://docs.anthropic.com/claude/docs/claude-cli)
  - [Gemini CLI](https://ai.google.dev/gemini-api/docs/cli)
  - [Ollama](https://ollama.ai/)

No manual database setup required.

---

## Getting Started

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

The board auto-starts when required.

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

We triage weekly.

---

## License

MIT
