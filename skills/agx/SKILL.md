# agx - Task Orchestrator for Autonomous AI Agents

Run AI agents that work autonomously across sessions. Uses `mem` for persistent memory.

## Core Concept: Wake-Work-Sleep Cycle

Agents have NO memory between sessions. All continuity comes from `mem`:

```
WAKE → Load state from mem → WORK → Save state to mem → SLEEP → repeat
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
agx pause [task]        # Pause task
agx remove [task]       # Remove task
```

## Steering: Nudge a Task

Send guidance to an agent for its next wake cycle:

```bash
agx nudge <task> "focus on auth first"    # Add nudge
agx nudge <task>                          # View pending nudges
```

Nudges are shown to the agent on wake and then cleared.

## Memory Commands (via mem)

Agents use these to persist state:

### Define Objective
```bash
mem goal "<objective>"        # Set/update goal
mem criteria add "<text>"     # Add success criterion
mem constraint add "<rule>"   # Add boundary/constraint
```

### Track Progress
```bash
mem next "<step>"             # Set what you're working on
mem checkpoint "<msg>"        # Save progress point
mem criteria <n>              # Mark criterion #n complete
mem progress                  # Check progress %
```

### Learn & Adapt
```bash
mem learn "<insight>"         # Task-specific learning
mem learn -g "<insight>"      # Global learning (all tasks)
mem stuck "<reason>"          # Mark blocker
mem stuck clear               # Clear blocker
```

### Build Playbook
```bash
mem learnings -g              # List global learnings
mem promote <n>               # Promote learning to playbook
mem playbook                  # View global playbook
```

### Complete
```bash
mem done                      # Mark task complete
```

## Agent Workflow

When an agent wakes, it should:

1. **Orient** - Read state (goal, criteria, progress, next step)
2. **Plan** - Define criteria if missing, set intent with `mem next`
3. **Execute** - Work toward criteria, save learnings
4. **Checkpoint** - Save progress with `mem checkpoint`
5. **Adapt** - Handle blockers or ask user for nudge

## Daemon Mode

Run tasks on a schedule:

```bash
agx daemon start              # Start daemon
agx daemon stop               # Stop daemon
agx daemon status             # Check status
agx daemon logs               # View logs
```

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

- **Memory is everything** - Agents forget between sessions. Save state.
- **Criteria drive completion** - No criteria = no way to know when done.
- **Checkpoint often** - Sessions can die anytime.
- **Ask when stuck** - Get a nudge from the user vs. spinning.
- **Learn & promote** - Build the playbook for future tasks.
