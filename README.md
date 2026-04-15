<p align="center">
  <br>
  <img src="agx_icon.png" width="160" alt="AGX Icon">
</p>

<h3 align="center">Persistent memory for AI coding agents.</h3>

<p align="center">
  Your agents lose context every session. AGX checkpoints their state so they resume instantly — <br>
  no replaying history, no burning tokens. Works with Claude, Codex, Gemini, and Ollama.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mndrk/agx"><img src="https://img.shields.io/npm/dm/@mndrk/agx?color=blue&style=flat-square" alt="NPM Downloads"></a>
  <a href="https://www.npmjs.com/package/@mndrk/agx"><img src="https://img.shields.io/npm/v/@mndrk/agx?color=orange&style=flat-square" alt="NPM Version"></a>
  <a href="https://github.com/ramarlina/agx/stargazers"><img src="https://img.shields.io/github/stars/ramarlina/agx?color=blue&style=flat-square" alt="GitHub Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License"></a>
  <a href="https://github.com/ramarlina/agx/pulls?q=is%3Apr+is%3Amerged"><img src="https://img.shields.io/badge/PRs_merged_by_agents-133-blueviolet?style=flat-square" alt="Agent PRs"></a>
</p>

```bash
npm install -g @mndrk/agx && agx init
```

<!-- 🎬 Terminal demo — drop a GIF or mp4 here showing: agx new → agent runs → checkpoint → resume -->
<p align="center">
  <a href="https://github.com/ramarlina/agx">
    <img src="agx-chat-to-tasks.gif" alt="AGX — chat with agents, approve before they act" width="100%">
  </a>
</p>

<p align="center">
  <a href="https://runagx.com">Website</a> •
  <a href="https://runagx.com/blog">Blog</a> •
  <a href="#get-agx">Install</a> •
  <a href="#what-you-get">Features</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#cli">CLI</a> •
  <a href="#development">Development</a>
</p>

---

## The Problem

Every AI coding agent — Claude, Codex, Gemini — starts from scratch each session. Long tasks get expensive to re-explain. Context gets lost. Work gets repeated.

## The Fix

AGX checkpoints agent state after every step. When you resume, the agent picks up exactly where it left off. No replaying history, no burning tokens on context windows. **Resuming is constant-cost** whether the task ran for 5 minutes or 5 days.

Ships as a CLI, a local web dashboard, and a macOS desktop app — all from one repo.

> **Dogfooded hard:** 133 PRs and 500+ commits merged by AGX agents building AGX itself. [Read more →](https://runagx.com/blog)

---

## Quickstart (2 minutes)

```bash
npm install -g @mndrk/agx
cd my-project
agx init                   # Picks up your API keys automatically
agx new "Add rate limiting to the API"   # Create your first task
agx run 1                  # Watch the agent work
# ...close your laptop, come back tomorrow...
agx run 1                  # Resumes instantly from the last checkpoint
```

## Get AGX

### npm (recommended)

```bash
npm install -g @mndrk/agx
cd my-project
agx init                   # First-time setup — picks up your API keys
agx board start            # Open the local dashboard
```

### Desktop App (macOS)

Download from [Releases](https://github.com/ramarlina/agx/releases). Bundles the UI, CLI, and Node runtime — install and go.

### From Source

```bash
git clone https://github.com/ramarlina/agx.git
cd agx && npm install
npm run local:dev          # Run the dashboard in dev mode
```

---

## What You Get

- **Chat with any provider** — Claude, Codex, Gemini, Ollama. Switch freely.
- **Durable tasks** — Survive restarts, crashes, and reboots. State is checkpointed, not rebuilt from conversation history.
- **Human-in-the-loop** — Agents pause at gates for your explicit approve/reject before touching anything dangerous.
- **Local dashboard** — Project home, agent chat, built-in terminal, Linear integration. See what's running at a glance.
- **Agent teams** — Group agents by role (engineering, research, ops). Tasks route automatically by tag.
- **Live presence** — See which agents are active in the sidebar, on projects, and on Linear issues in real time.
- **Fully local** — Runs on your machine. Your code never leaves. Full execution logs, task signing, destructive-command safeguards.

---

## CLI

The CLI manages tasks, runs agents, and controls the dashboard.

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

### Environment Variables

```bash
agx vars set API_URL https://example.com    # Set a variable
agx vars get API_URL                        # Get a variable
agx vars list                               # List all variables
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

## How It Works

AGX treats agent memory as **durable state**, not conversation history.

Each task runs in a **Wake - Work - Sleep** loop:

1. **Wake** — Load full context from the last checkpoint
2. **Work** — Execute commands, edit files, validate output
3. **Sleep** — Save state and yield, ready to resume anytime

Resuming is constant-cost. A task that ran for a week resumes as fast as one that ran for a minute.

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

This repo is an npm workspace. CLI, dashboard, and desktop app all live here — clone once, run everything.

```text
agx/
  apps/
    local/          # Next.js dashboard (Home, chat, terminal, teams, objectives, Linear)
    desktop/        # Electron macOS app (bundles dashboard, CLI, and Node runtime)
  lib/              # CLI and runtime source
  commands/         # CLI command implementations
  cloud-runtime/    # Packaged standalone dashboard bundled into the npm artifact
```

### Run the dashboard

```bash
npm install
npm run local:dev        # Start the dashboard at localhost
```

### Build the dashboard

```bash
npm run local:build      # Production build
npm run board:bundle     # Package standalone runtime for the CLI
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
  <strong>Stop re-explaining context. Let your agents remember.</strong><br><br>
  <a href="https://github.com/ramarlina/agx/stargazers">⭐ Star this repo</a> if AGX saves you time · <a href="https://github.com/ramarlina/agx/issues">Report a bug</a> · <a href="https://runagx.com">runagx.com</a>
</p>
