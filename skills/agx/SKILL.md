# agx - Task Orchestrator for Autonomous AI Agents

Run AI agents that work autonomously across sessions. Uses cloud API for persistent memory and task management.

## Core Concept: Wake-Work-Sleep Cycle

Agents have NO memory between sessions. All continuity comes from the API:

```
WAKE -> Load state from API -> WORK -> Save state to API -> SLEEP -> repeat
```

## Quick Start

```bash
# Create and run a task
agx new "Build a REST API with auth"
agx run build-rest-api

# Or one command for autonomous mode
agx -a -p "Build a REST API with auth"
```

## Task Management

```bash
agx new "<goal>"        # Create task
agx run [task]          # Run task (loads context, wakes agent)
agx tasks               # List all tasks
agx status              # Current task status
agx context [task]      # View task context
```

## Task Commands (Docker-style namespaces)

```bash
agx task ls           # List all tasks
agx task logs <id>    # View task logs
agx task logs -f <id> # Follow task logs
agx task stop <id>    # Stop a task
agx task rm <id>      # Remove a task
agx info <task>       # Get detailed task info
agx complete <taskId> # Mark task stage as complete
agx pull              # Pull next task from queue
```

## Container Commands (Docker-style namespaces)

```bash
agx container ls       # List running containers (daemons)
agx container logs     # View daemon logs
agx container stop     # Stop running containers
```

## Steering: Nudge a Task

Send guidance to an agent for its next wake cycle:

```bash
agx nudge <task> "focus on auth first"    # Add nudge
agx nudge <task>                          # View pending nudges
```

Nudges are stored and shown to the agent on wake, then cleared.

## Agent Workflow

When an agent wakes, it should:

1. **Orient** - Read state (goal, criteria, progress, next step)
2. **Plan** - Define criteria if missing, set intent via API
3. **Execute** - Work toward criteria, save learnings
4. **Checkpoint** - Save progress
5. **Adapt** - Handle blockers or ask user for nudge

## State Operations

Agents interact with the API directly for state persistence:

### Define Objective
```bash
# Set goal and criteria via agx (sends to API)
agx new "Build a REST API" --criteria "Auth works" --criteria "CRUD endpoints"
```

### Track Progress
```bash
# Agent uses API to update state
# (typically through agx commands, not direct API calls)
```

### Complete Stage
```bash
agx complete <taskId>  # Mark task stage complete
agx pull <task>        # Pull next stage from queue
```

### Query
```bash
agx info <task>        # Get task info
agx task ls            # List all tasks
```

## Daemon Mode

Run tasks on a schedule:

```bash
agx daemon start              # Start daemon (polls for tasks)
agx daemon stop               # Stop daemon
agx daemon status             # Check status
agx daemon logs               # View logs
```

The daemon continuously polls the API for active tasks.

## Providers

```bash
agx claude [args]             # Claude (alias: c)
agx gemini [args]             # Gemini (alias: g)
agx ollama [args]             # Ollama (alias: o)
```

## Key Flags

```bash
-a, --autonomous    # Full auto: create task + daemon + work until done
-p, --prompt        # The prompt/goal
-y, --yolo          # Skip confirmations
--continue <task>   # Continue specific task
```

## Key Principles

- **Persistent storage is everything** - Agents forget between sessions. Save state.
- **Criteria drive completion** - No criteria = no way to know when done.
- **Checkpoint often** - Sessions can die anytime. Sync to API.
- **Ask when stuck** - Get a nudge from the user vs. spinning.
- **Learn & adapt** - Build knowledge for future tasks via API.
