<p align="center">
  <br>
  <img src="agx_icon.png" width="256" alt="AGX Icon">
</p>

<p align="center">
  <strong>Your AI team's command center.</strong><br>
  Chat with AI agents. Watch them plan. Approve before they act.<br>
  All running locally on your machine.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mndrk/agx"><img src="https://img.shields.io/npm/dm/@mndrk/agx?color=blue&style=flat-square" alt="NPM Downloads"></a>
  <a href="https://www.npmjs.com/package/@mndrk/agx"><img src="https://img.shields.io/npm/v/@mndrk/agx?color=orange&style=flat-square" alt="NPM Version"></a>
  <a href="https://github.com/ramarlina/agx/stargazers"><img src="https://img.shields.io/github/stars/ramarlina/agx?color=blue&style=flat-square" alt="GitHub Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <a href="#get-agx">Get AGX</a> •
  <a href="#ui">UI</a> •
  <a href="#desktop-app">Desktop</a> •
  <a href="#cli">CLI</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#development">Development</a>
</p>

---

## What is AGX?

AGX is a **local-first command center for AI agents**. Drop an idea into a multi-agent chat, let agents debate and plan, route work onto a task board, and approve before they act. Everything runs on your machine.

<p align="center">
  <a href="https://github.com/ramarlina/agx">
    <img src="agx_chat.jpg" alt="AGX Demo" width="100%">
  </a>
</p>

AGX ships three surfaces that work together:

| Surface | What it does |
|---------|-------------|
| **UI** | Local web dashboard — multi-agent chat, Linear integration, task management |
| **Desktop** | macOS app — bundles the UI, CLI, and Node runtime in one install |
| **CLI** | Terminal interface — create tasks, run agents, manage projects, one-shot prompts |

All three share the same local SQLite database. The UI is where you chat and track work; the CLI is the execution engine; the desktop app wraps both.

---

## Get AGX

### Desktop App (macOS)

Download from [Releases](https://github.com/ramarlina/agx/releases). The desktop app bundles the UI, CLI, and a Node runtime — install and go.

### CLI via npm

```bash
npm install -g @mndrk/agx
cd my-project
agx init
```

The CLI ships with the UI built in. No separate install needed.

---

## UI

The local web dashboard is the primary interface. It runs as a Next.js app on your machine.

```bash
agx board start        # Open the dashboard in your browser
agx daemon start       # Start the background worker
```

**Multi-agent chat** — Talk to Claude, Codex, Gemini, or Ollama in the same thread. @mention specific agents or let the router pick. Push conversation outcomes directly to tasks.

```bash
agx chat               # Start server + open in browser
agx chat start         # Start server only (headless)
agx chat stop          # Stop the chat server
```

**Linear integration** — Connect your Linear workspace to browse issues, track cycles, mention issues in chat, and route execution results back to Linear.

---

## Desktop App

The macOS desktop app bundles the UI, CLI, and a Node runtime into a single install. Download from [Releases](https://github.com/ramarlina/agx/releases) — no npm or Node.js required.

---

## CLI

The CLI is the execution engine and the glue between chat, board, and agents.

### Setup

```bash
agx init                       # First-time setup wizard
agx config                     # Reconfigure providers, models, backend URL
```

### Tasks

```bash
agx new "<goal>"                                 # Create a new task
agx run <task_id>                               # Run a specific task
agx status [task-id-or-slug]                    # Show status
agx retry <task_id-or-slug> [--from <stage>]    # Reset + retry
agx approve <task> [--node <node-id>] [-m "feedback"]  # Approve a gate
agx reject <task> [--node <node-id>] [-m "feedback"]   # Reject a gate
agx deps <task> [--depends-on <task> ... | --clear]    # Manage dependencies
```

### Projects & Repos

```bash
agx project list                           # List projects
agx repo add . --project my-project        # Analyze current repo and attach it
agx repo add ../service --project my-project --name API
```

### One-Shot Mode

```bash
agx -p "Explain this error"
agx claude -p "Refactor this function"
agx codex -p "Propose a migration plan"
```

### Providers

| Provider | Alias | Command      |
| -------- | ----- | ------------ |
| Claude   | `c`   | `agx claude` |
| Codex    | `x`   | `agx codex`  |
| Gemini   | `g`   | `agx gemini` |
| Ollama   | `o`   | `agx ollama` |

### Key Flags

```bash
-p, --prompt        # Task goal
-P, --provider      # c | x | g | o
-m, --model         # Explicit model for provider commands
-a, --autonomous    # Create task + start daemon + run until done
-y, --yolo          # Skip confirmations during execution (implied by -a)
--swarm             # Multi-agent swarm execution mode
```

---

## Features

- **Execution graphs** — Tasks run as dynamic graphs, not fixed linear stages. Branch, fork, join — the graph is a map of decisions, not a to-do list.
- **Human-in-the-loop gates** — Critical nodes pause for your explicit `approve` / `reject`. Agents do the heavy lifting; you stay in control.
- **Durable, resumable execution** — Tasks survive restarts, crashes, and reboots. State is checkpointed, not rebuilt from history.
- **Multi-provider** — Claude, Codex, Gemini, Ollama. Use whatever fits.
- **Local & inspectable** — Runs entirely on your machine. Full execution logs, task signing, safeguards for destructive commands.

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
│ Dashboard    │◄─►│ SQLite       │◄─►│ Task Queue │
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

## Prerequisites

- **Node.js** >= 22.16.0 (CLI install only; desktop app bundles its own runtime)
- **At least one AI provider CLI:**
  - [Claude Code](https://docs.anthropic.com/claude/docs/claude-cli)
  - [OpenAI Codex CLI](https://www.npmjs.com/package/@openai/codex)
  - [Gemini CLI](https://ai.google.dev/gemini-api/docs/cli)
  - [Ollama](https://ollama.ai/)

No external database required. AGX uses SQLite locally.

---

## Development

This repo is an npm workspace with the following structure:

```text
agx/
  apps/
    local/          # Next.js dashboard + chat (ships with CLI and desktop app)
    desktop/        # Electron macOS app (bundles dashboard, CLI, and Node runtime)
  lib/              # CLI and runtime source
  commands/         # CLI command implementations
  cloud-runtime/    # Packaged standalone dashboard bundled into the npm artifact
```

The npm package (`@mndrk/agx`) is published from the repo root. `apps/local` and `apps/desktop` are private workspaces — they are not published to npm.

### Getting started

```bash
npm install

# Run the dashboard in development mode
npm run local:dev

# Build the dashboard
npm run local:build

# Package the standalone dashboard runtime for the CLI
npm run board:bundle
```

### Desktop app

```bash
cd apps/desktop
npm run dev              # Launch Electron in dev mode
npm run build:mac        # Build the macOS .app + .dmg
```

### Tech stack

* **Dashboard/Chat:** Next.js, Tailwind CSS
* **Desktop:** Electron, electron-builder
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
| Node.js version | `v22.16.0` |
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
  <strong>Not a chatbot. Your AI team's command center.</strong>
</p>
