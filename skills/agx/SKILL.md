# agx - Unified AI Agent CLI

Use `agx` to run AI agents (Claude Code, Gemini, Ollama) with persistent memory. Spawn autonomous tasks that work in the background until complete.

## When to Use

- **Autonomous agents** for long-running tasks
- **Background work** that continues without supervision
- **Running different AI providers** with unified interface
- **Persistent memory** across sessions

## Basic Usage

```bash
agx -p "prompt"                     # Default provider
agx claude -p "prompt"              # Claude Code
agx gemini -p "prompt"              # Gemini
agx ollama -p "prompt"              # Ollama (local)
```

## Task Management

```bash
agx init <name> "<goal>"    # Create new task
agx status                  # Show current state
agx tasks                   # List all tasks
agx done                    # Mark complete
agx stuck [reason|clear]    # Mark/clear blocker
agx switch <name>           # Switch tasks
agx checkpoint "<msg>"      # Save progress point
agx learn "<insight>"       # Record learning
agx next "<step>"           # Set next step
agx wake "<schedule>"       # Set wake (e.g. "every 15m")
agx progress                # Show % complete
agx criteria add "<text>"   # Add criterion
agx criteria <N>            # Mark criterion #N complete
```

## Autonomous Mode

Start a task that runs autonomously until complete:

```bash
cd ~/Projects/my-app
agx -a -p "Build a React todo app with auth"
# ✓ Created task: build-react-todo
# ✓ Mapped: ~/Projects/my-app → task/build-react-todo
# ✓ Daemon started (pid 12345)
# ✓ Autonomous mode: daemon will continue work every 15m
```

The `-a` flag:
1. Creates a task with your prompt as the goal
2. Starts the agx daemon (if not running)
3. Skips prompts (`-y` implied)
4. Daemon wakes every 15m to continue
5. Stops when agent outputs [done] or [blocked]

## Daemon Management

```bash
agx daemon start    # Start background daemon
agx daemon stop     # Stop daemon
agx daemon status   # Check if running
agx daemon logs     # Show recent logs
```

The daemon:
- Runs in background (survives terminal close)
- Wakes every 15 minutes
- Continues work on active tasks
- Respects per-task wake intervals

## Output Markers

Use these in agent output to control state:

### Progress (parsed automatically)
```
[checkpoint: message]   # Save progress point
[learn: insight]        # Record learning
[next: step]            # Set next step
[criteria: N]           # Mark criterion #N complete
```

### Stopping Markers
```
[done]                  # Task complete, stop
[blocked: reason]       # Need human help, pause
[approve: question]     # Need approval, wait
```

**Default behavior:** Keep working. Only output stopping markers when needed.

## Provider Aliases

| Provider | Aliases | Description |
|----------|---------|-------------|
| claude | c, cl | Anthropic Claude Code |
| gemini | g, gem | Google Gemini |
| ollama | o, ol | Local Ollama |

## Common Flags

```bash
--autonomous, -a    # Create task + daemon, run unattended
--task NAME         # Specific task name
--criteria "..."    # Success criterion (repeatable)
--yolo, -y          # Skip confirmations
--model, -m         # Model name
```

## Examples

### Quick one-shot
```bash
agx -p "Explain this error" -y
```

### Create task with criteria
```bash
agx init api-task "Build REST API"
agx criteria add "CRUD endpoints"
agx criteria add "Auth with JWT"
agx -p "Let's build this"
```

### Autonomous task
```bash
cd ~/Projects/api
agx -a -p "Add user authentication with JWT"
# Daemon continues work every 15m until done
```

### Check on a running task
```bash
agx daemon status   # Check daemon
agx status          # Task summary
agx progress        # % complete
```

### Manual continue
```bash
cd ~/Projects/api
agx -p "continue"   # Resume from last checkpoint
```
