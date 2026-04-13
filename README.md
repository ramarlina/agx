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
  <a href="https://runagx.com">Website</a> •
  <a href="https://runagx.com/blog">Blog</a> •
  <a href="#get-agx">Get AGX</a> •
  <a href="#ui">UI</a> •
  <a href="#desktop-app">Desktop</a> •
  <a href="#cli">CLI</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#development">Development</a>
</p>

---

## What is AGX?

AGX is a **local-first command center for AI agents**. Set up projects, organize agent teams, define objectives, chat with agents, and run tasks — all from one app on your machine.

<p align="center">
  <a href="https://github.com/ramarlina/agx">
    <img src="agx_chat.jpg" alt="AGX Demo" width="100%">
  </a>
</p>

Everything lives in one repo — CLI, web dashboard, and desktop app. Clone it and you have the full stack.

| Surface | What it does |
|---------|-------------|
| **UI** | Local web dashboard — project home, teams, objectives, chat, terminal, Linear integration |
| **Desktop** | macOS app — bundles the UI, CLI, and Node runtime in one install |
| **CLI** | Terminal interface — create tasks, run agents, manage projects, environment variables |

All three share the same local SQLite database and ship from the same repo.

---

## Get AGX

### From Source

```bash
git clone https://github.com/ramarlina/agx.git
cd agx && npm install
npm run local:dev          # Run the dashboard in dev mode
```

This gives you the full stack — CLI, web dashboard, and desktop app source. See [Development](#development) for more.

### npm

```bash
npm install -g @mndrk/agx
cd my-project
agx init
```

Installs the CLI with the dashboard bundled in. Run `agx board start` to open the UI.

### Desktop App (macOS)

Download from [Releases](https://github.com/ramarlina/agx/releases). The desktop app bundles the UI, CLI, and a Node runtime — install and go.

Or build from source:

```bash
cd apps/desktop
npm run build:mac          # Build the macOS .app + .dmg
```

---

## UI

The local web dashboard runs as a Next.js app on your machine. Source lives in `apps/local`.

```bash
agx board start        # Open the dashboard in your browser
agx ui open            # Alias for agx board open
agx daemon start       # Start the background worker
```

Older `agx chat`, `agx chat start`, `agx chat open`, and `agx chat stop` commands still work as compatibility wrappers, but `agx board` is now the canonical UI command group.

### Setup

First launch walks you through a guided setup: detect and authenticate providers, create your first project, and configure agent teams. You land in Home when you're done.

### Home

Home is the persistent home base for each project, organized in three tiers:

- **Direction** — Objectives define where the project is going. Track health, progress, and link to scheduled work.
- **Paths** — Launch into Chat, Terminal, or Linear from here. Chat is the primary work surface; Terminal gives you PTY sessions with split panes.
- **Momentum** — Running agents, recent scheduled task results, and an activity feed. Shows what's actively happening.

### Teams

Projects are organized around agent teams. Pick from preset templates (engineering, research, ops, etc.) or build custom teams. Tasks route to team agents automatically based on tags.

### Objectives

File-based objectives stored as frontmatter markdown in `~/.agx`. Each objective has an activity timeline, notes, health status, and can drive scheduled Linear work.

### Terminal

Built-in terminal with PTY sessions, WebSocket bridge, and split panes. Sessions persist and show active agent presence.

### Chat

Talk to Claude, Codex, Gemini, or Ollama. Push conversation outcomes to tasks or objectives.

### Linear Integration

Connect your Linear workspace to browse issues, track cycles, and route execution results back. Issues show active agent presence when work is running.

---

## Desktop App

The macOS desktop app bundles the UI, CLI, and a Node runtime into a single install. Download from [Releases](https://github.com/ramarlina/agx/releases) or [build from source](#get-agx).

---

## CLI

The CLI manages tasks, runs agents, and controls the dashboard and daemon.

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

## Features

- **Project home** — Objectives, chat, terminal, and Linear in one view. See what's running, what's on track, and where to jump in.
- **Agent teams** — Preset templates for engineering, research, ops. Tasks route to team agents by tag. YAML export/import for portable config.
- **Objectives** — File-based goals with activity timelines, health tracking, and notes. Drive scheduled work from objectives.
- **Built-in terminal** — PTY sessions with split panes and agent presence indicators. Sessions persist across restarts.
- **Execution graphs** — Tasks run as dynamic graphs with branch, fork, and join. Human-in-the-loop gates pause for your explicit `approve` / `reject`.
- **Durable, resumable execution** — Tasks survive restarts, crashes, and reboots. State is checkpointed, not rebuilt from history.
- **Multi-provider** — Claude, Codex, Gemini, Ollama. Use whatever fits.
- **Local & inspectable** — Runs entirely on your machine. Full execution logs, task signing, safeguards for destructive commands.
- **Live agent presence** — See which agents are active on the sidebar, project overview, and Linear issues in real time.

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
  <strong>Not a chatbot. Your AI team's command center.</strong>
</p>
