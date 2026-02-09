# agx

Task orchestrator for autonomous AI agents. Uses cloud API for persistent storage and task management.

```bash
npm install -g @mndrk/agx
```

## Core Concept: Wake-Work-Sleep Cycle

Agents have **no memory** between sessions. All continuity comes from the cloud API:

```
WAKE -> Load state from cloud -> WORK -> Save state to cloud -> SLEEP -> repeat
```

This enables truly autonomous operation across multiple sessions.

## Quick Start

```bash
# Create and run a task
agx new "Build a REST API with auth"
agx run build-rest-api

# Or one command for full autonomous mode
agx -a -p "Build a REST API with auth"
# ✓ Created task: build-rest-api
# ✓ Daemon started
# ✓ Working...
```

## Task Management

```bash
agx new "<goal>"       # Create task
agx run [task]         # Run task (loads context from cloud, wakes agent)
agx run [task] --swarm # Run task via swarm
agx tasks              # Interactive TUI - browse all tasks
agx status             # Current task status
agx context [task]     # View task context
```

### Task Commands (Docker-style namespaces)

```bash
agx task ls           # List all tasks
agx task logs <id>    # View task logs
agx task tail <id>    # Tail task logs
agx task stop <id>    # Stop a task
agx task rm <id>      # Remove a task
agx info <task>       # Get detailed task info
agx complete <taskId> # Mark task stage as complete
```

## Projects

Structured project metadata is managed entirely in the cloud. The CLI exposes the following helpers:

```bash
agx project list
agx project get <project-id|slug>
agx project create --name "<name>" [--slug <slug>] [--description "<text>"] [--ci "<info>"] \
                 [--metadata key=value ...] [--repo '{"name":"app","path":"/src","git_url":"https://github.com/...","notes":"local"}']
agx project update <project-id|slug> [--name "<name>"] [--slug <slug>] [--description "<text>"] \
                 [--ci "<info>"] [--metadata key=value ...] [--repo ...]
```

Use `--metadata key=value` to attach arbitrary key/value decisions and `--repo` to describe repo paths or remote URLs. Every `agx project` command talks to the cloud `/api/projects` APIs so you always see your latest structured context.

Link tasks to projects when you create them:

```bash
agx new "Build auth flow" --project-slug my-app --project-id 123e4567-e89b-12d3-a456-426614174000
```

`--project-slug` prefers the canonical slug for prompts, while `--project-id` records the structured reference; fall back to the legacy `--project` free-form title if you do not yet have a project slug.

### Container Commands (Docker-style namespaces)

```bash
agx container ls      # List running containers
agx container logs    # View container logs
agx container stop    # Stop container
```

### Interactive Tasks Browser

`agx tasks` opens a TUI showing all tasks with status, progress, and last run time.

Keys: `↑/↓` select, `enter` details, `r` run, `d` done

## Steering: Nudge a Task

Send guidance to an agent for its next wake cycle:

```bash
agx nudge <task> "focus on auth first"    # Add nudge
agx nudge <task>                          # View pending nudges
```

Nudges are stored and shown to the agent on wake, then cleared.

## Agent Workflow

When an agent wakes, it should:

1. **Orient** - Read state (goal, criteria, progress, next step, nudges)
2. **Plan** - Define criteria if missing, set intent via API
3. **Execute** - Work toward criteria, save learnings
4. **Checkpoint** - Save progress
5. **Adapt** - Handle blockers or ask user for nudge

## Daemon Mode

Run tasks automatically on a schedule:

```bash
agx daemon start       # Start background daemon
agx daemon stop        # Stop daemon
agx daemon status      # Check if running
agx daemon logs        # View logs

# Execution concurrency:
agx daemon start -w 4
```

The daemon:
- Pulls tasks from AGX Cloud queue and executes locally
- Reports stage results back to AGX Cloud
- Logs to `~/.agx/daemon.log`
- Optionally starts the embedded orchestrator worker (`npm run daemon:worker`) when running the local board runtime; logs to `~/.agx/orchestrator-worker.log`

## One-Shot Mode

For quick questions without task creation:

```bash
agx -p "explain this error"
agx claude -p "refactor this function"
```

## Providers

| Provider | Alias | Description |
|----------|-------|-------------|
| claude | c | Anthropic Claude Code |
| gemini | g | Google Gemini |
| ollama | o | Local Ollama |

## Key Flags

```bash
-a, --autonomous    # Full auto: create task + daemon + work until done
-p, --prompt        # The prompt/goal
--prompt-file       # Read prompt from file path (avoids argv size limits)
-y, --yolo          # Skip confirmations
--continue <task>   # Continue specific task
```

## Key Principles

- **Persistent storage is everything** - Agents forget between sessions. Save state.
- **Criteria drive completion** - No criteria = no way to know when done.
- **Checkpoint often** - Sessions can die anytime. Sync to API.
- **Ask when stuck** - Get a nudge from the user vs. spinning.
- **Learn & adapt** - Build knowledge for future tasks via API.

## Architecture

```
agx (agent execution)
 ├── Uses API for all state operations
 ├── Task CRUD via: agx commands
 ├── Nudges via: API
 ├── Context via: agx info / context
 └── Task orchestration: Orchestrator worker (pg-boss)

API
 ├── Task storage and retrieval
 ├── State persistence (goal, criteria, progress)
 ├── KV primitives (set/get/pop)
 └── Task queue and scheduling
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on our workflow.

- **Bugs & Features:** Use [GitHub Issues](https://github.com/mndrk/agx/issues).
- **Ideas & Questions:** Use [GitHub Discussions](https://github.com/mndrk/agx/discussions).

## License

MIT
