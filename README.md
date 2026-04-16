<p align="center">
  <br>
  <img src="agx_icon.png" width="128" alt="AGX Icon">
</p>

<h3 align="center">Use agents for real work. Stay in control.</h3>

<p align="center">
  Getting agents to do things isn't the hard part anymore. Keeping track of everything they do —<br>
  without losing context, missing changes, or creating messes you can't untangle — is.<br>
  AGX is how I use agents seriously. Works with Claude, Codex, Gemini, and Ollama.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mndrk/agx"><img src="https://img.shields.io/npm/dm/@mndrk/agx?color=blue&style=flat-square" alt="NPM Downloads"></a>
  <a href="https://www.npmjs.com/package/@mndrk/agx"><img src="https://img.shields.io/npm/v/@mndrk/agx?color=orange&style=flat-square" alt="NPM Version"></a>
  <a href="https://github.com/ramarlina/agx/stargazers"><img src="https://img.shields.io/github/stars/ramarlina/agx?color=blue&style=flat-square" alt="GitHub Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License"></a>
  <a href="https://github.com/ramarlina/agx/pulls?q=is%3Apr+is%3Amerged"><img src="https://img.shields.io/badge/PRs_merged_by_agents-167-blueviolet?style=flat-square" alt="Agent PRs"></a>
</p>

```bash
npm install -g @mndrk/agx && agx init
```

<!-- 🎬 Terminal demo — drop a GIF or mp4 here showing: agx new → agent runs → checkpoint → resume -->
<p align="center">
  <a href="https://github.com/ramarlina/agx">
    <img src="agx-chat-to-tasks.gif" alt="AGX — chat with agents, create tasks, approve before they act" width="100%">
  </a>
</p>

<p align="center">
  <a href="https://runagx.com">Website</a> •
  <a href="https://runagx.com/blog">Blog</a> •
  <a href="#get-agx">Install</a> •
  <a href="#what-you-get">Features</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#cli-quick-reference">CLI</a>
</p>

---

## Why I built this

Hi, I'm Mendrika.

I built AGX because I kept wanting to use agents for more and more real work. Feature builds. Bug fixes. Research. Follow-up tasks. The problem was never getting them to do things. The problem was keeping track of everything without getting lost.

That started to feel like the real bottleneck. The better the agents got, the more parallel work I wanted to run. And the more parallel work I ran, the easier it was to lose context, miss changes, and create messes I couldn't reliably untangle.

AGX is my attempt to solve that. It's an exploration of what it would take to use agents seriously, while still staying in control.

Ships as a CLI, a local web dashboard, and a macOS desktop app — all from one repo.

> **Dogfooded hard:** 133 PRs and 500+ commits merged by AGX agents building AGX itself. [Read more →](https://runagx.com/blog)

### What staying in control looks like

| | Ad-hoc agent usage | AGX |
|---|---|---|
| **Parallel work** | Tabs, scrollback, mental bookkeeping | Every task has a home; see what's running at a glance |
| **Resuming a task** | Re-explain everything from scratch | Instant — loads last checkpoint, constant cost |
| **Multi-session tasks** | Manual context stitching | Wake / work / sleep loop, picks up where it left off |
| **Crash recovery** | Lost work | Checkpointed state survives restarts |
| **Human gates** | Whatever you remember to check | Built-in approve/reject before anything irreversible |
| **Provider lock-in** | One provider per session | Switch Claude ↔ Codex ↔ Gemini ↔ Ollama freely |
| **Observability** | Terminal scrollback | Dashboard, live presence, execution logs |

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

<details>
<summary>Build from source</summary>

```bash
git clone https://github.com/ramarlina/agx.git
cd agx && npm install
npm run local:dev          # Run the dashboard in dev mode
```

</details>

---

## What You Get

- **A home for every task** — Objectives, scheduled jobs, chat threads, and terminal sessions all live under their project. Nothing is free-floating.
- **Chat with any provider** — Claude, Codex, Gemini, Ollama. Switch freely mid-task.
- **Durable tasks** — Survive restarts, crashes, and reboots. State is checkpointed, not rebuilt from conversation history.
- **Human-in-the-loop** — Agents pause at gates for your explicit approve/reject before touching anything dangerous.
- **Agent teams** — Group agents by role (engineering, research, ops). Tasks route automatically by tag.
- **Live presence** — See which agents are active on which projects and tasks in real time.
- **Fully local** — Runs on your machine. Your code never leaves. Full execution logs, task signing, destructive-command safeguards.

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

## CLI Quick Reference

```bash
agx new "build login page"       # Create a task
agx run <id>                     # Run it
agx status                       # Check progress
agx approve <id>                 # Approve a human gate
```

| Provider | Alias | Command |
|----------|-------|---------|
| Claude | `c` | `agx claude -p "..."` |
| Codex | `x` | `agx codex -p "..."` |
| Gemini | `g` | `agx gemini -p "..."` |
| Ollama | `o` | `agx ollama -p "..."` |

| Flag | Purpose |
|------|---------|
| `-p` | Task goal / prompt |
| `-a` | Autonomous mode (create + run until done) |
| `-y` | Skip confirmations |
| `--swarm` | Multi-agent execution |

<details>
<summary>Full CLI reference</summary>

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

### Setup

```bash
agx init                       # First-time setup wizard
agx config                     # Reconfigure providers, models, backend URL
```

</details>

---

## Prerequisites

- **Node.js** >= 22.16.0 (CLI install only; desktop app bundles its own runtime)
- **At least one AI provider CLI:**
  [Claude Code](https://docs.anthropic.com/claude/docs/claude-cli) ·
  [Codex CLI](https://www.npmjs.com/package/@openai/codex) ·
  [Gemini CLI](https://ai.google.dev/gemini-api/docs/cli) ·
  [Ollama](https://ollama.ai/)

No external database required. AGX uses SQLite locally.

---

<details>
<summary><strong>Development</strong></summary>

This repo is an npm workspace. CLI, dashboard, and desktop app all live here — clone once, run everything.

```text
agx/
  apps/
    local/          # Next.js dashboard (project home, chat, terminal, teams, objectives, tasks)
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

</details>

<details>
<summary><strong>Contributing</strong></summary>

Contributions welcome.

* **Ideas & questions:** GitHub Discussions
* **Bugs & features:** GitHub Issues
* **PRs:** Fork `main`, add tests, submit

</details>

<details>
<summary><strong>Telemetry</strong></summary>

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

</details>

---

## License

MIT

---

<p align="center">
  <strong>Stop re-explaining context. Let your agents remember.</strong><br><br>
  <a href="https://github.com/ramarlina/agx/stargazers">⭐ Star this repo</a> if AGX saves you time · <a href="https://github.com/ramarlina/agx/issues">Report a bug</a> · <a href="https://runagx.com">runagx.com</a>
</p>
