# agx - Task Orchestrator for Autonomous AI Agents

Run AI agents that work autonomously across sessions. Uses cloud API for persistent memory and task management.

## Core Concept: Wake-Work-Sleep Cycle

Agents have NO memory between sessions. All continuity comes from the API:

```
WAKE -> Load state from API -> WORK -> Save state to API -> SLEEP -> repeat
```

## Quick Start

```bash
# One-shot question
agx -p "explain this code"

# Create and run a task
agx new "Build a REST API with auth"
agx run <task_id>

# Fully autonomous
agx -a -p "Build a REST API with auth"
```

## Task Management

```bash
agx init              # Initialize AGX
agx new "<goal>"      # Create task
agx run <task_id>     # Run a specific task
agx status            # Current task status
agx complete <taskId> # Mark task stage complete
```

## Task Dependencies (ordering)

```bash
agx new "Task C" --depends-on <taskA-id> --depends-on <taskB-id>
agx deps <task-c>                                  # Show depends_on + dependents
agx deps <task-c> --depends-on <taskA> --depends-on <taskB>  # Set dependencies
agx deps <task-c> --clear                          # Remove all dependencies
```

Use task UUIDs, slugs, or `agx task ls` index references.

## Monitoring

```bash
agx task ls           # List all tasks
agx task logs <id>    # View task logs
agx task stop <id>    # Stop a task
agx watch             # Watch task updates in real-time (SSE)
```

## Daemon Mode

```bash
agx daemon start      # Start daemon (polls for tasks)
agx daemon stop       # Stop daemon
agx daemon status     # Check status
```

## Providers

```bash
agx claude [args]     # Claude (alias: c)
agx gemini [args]     # Gemini (alias: g)
agx ollama [args]     # Ollama (alias: o)
```

## Key Flags

```bash
-p, --prompt        # The prompt/goal
-P, --provider      # Specify provider (c|g|o)

# Runtime flags (for run/retry/-a, not new):
-a, --autonomous    # Full auto: create task + daemon + work until done
-y, --yolo          # Skip confirmations during execution (implied by -a)
```
