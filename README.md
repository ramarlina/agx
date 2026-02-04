# agx

Task orchestrator for autonomous AI agents. Uses `mem` for persistent memory across sessions.

```bash
npm install -g @mndrk/agx
```

## Core Concept: Wake-Work-Sleep Cycle

Agents have **no memory** between sessions. All continuity comes from `mem`:

```
WAKE → Load state → WORK → Save state → SLEEP → repeat
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
agx run [task]         # Run task (loads context, wakes agent)
agx tasks              # Interactive TUI - browse all tasks
agx status             # Current task status
agx context [task]     # View task context
agx pause [task]       # Pause task
agx remove [task]      # Delete task (alias: rm, delete)
agx tail [task]        # Live tail logs
```

### Interactive Tasks Browser

`agx tasks` opens a TUI showing all tasks with status, progress, and last run time.

Keys: `↑/↓` select, `enter` details, `r` run, `p` pause, `d` done, `x` remove

## Steering: Nudge a Task

Send guidance to an agent for its next wake cycle:

```bash
agx nudge <task> "focus on auth first"    # Add nudge
agx nudge <task>                          # View pending nudges
```

Nudges are shown to the agent on wake and then cleared.

## Memory Commands (via mem)

Agents persist state using these commands:

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

### Query
```bash
mem context                   # Full context for agent
mem history                   # Task progression
mem query "<search>"          # Search all memory
```

### Complete
```bash
mem done                      # Mark task complete
```

## Agent Workflow

When an agent wakes, it should:

1. **Orient** - Read state (goal, criteria, progress, next step, nudges)
2. **Plan** - Define criteria if missing, set intent with `mem next`
3. **Execute** - Work toward criteria, save learnings
4. **Checkpoint** - Save progress with `mem checkpoint`
5. **Adapt** - Handle blockers or ask user for nudge

## Daemon Mode

Run tasks automatically on a schedule:

```bash
agx daemon start       # Start background daemon
agx daemon stop        # Stop daemon
agx daemon status      # Check if running
agx daemon logs        # View logs
```

The daemon:
- Polls continuously for active tasks
- Runs up to 5 tasks in parallel
- Logs to `~/.agx/logs/<taskname>.log`

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
-y, --yolo          # Skip confirmations
--continue <task>   # Continue specific task
```

## Key Principles

- **Memory is everything** - Agents forget between sessions. Save state.
- **Criteria drive completion** - No criteria = no way to know when done.
- **Checkpoint often** - Sessions can die anytime.
- **Ask when stuck** - Get a nudge from the user vs. spinning.
- **Learn & promote** - Build the playbook for future tasks.

## Architecture

```
agx (agent execution)
 ├── Uses mem CLI for all state operations
 ├── Nudges via: mem set/get/pop
 ├── Tasks via: mem tasks --json
 └── Context via: mem context --json

mem (storage layer)
 ├── Git-backed state in ~/.mem
 ├── Branch per task
 └── KV primitives (set/get/pop)
```

## License

MIT
