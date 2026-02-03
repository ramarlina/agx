# agx - Unified AI Agent Wrapper

Use `agx` to run AI agents (Claude Code, Gemini, Ollama) with persistent memory integration. Spawn autonomous tasks that work in the background until complete.

## When to Use

- **Autonomous agents** for long-running tasks
- **Background work** that continues without supervision
- **Running different AI providers** with unified interface
- **Persistent memory** across sessions

## Basic Usage

```bash
agx claude -p "prompt"              # Run Claude Code
agx gemini -p "prompt"              # Run Gemini
agx ollama -p "prompt"              # Run Ollama (local)
```

## Autonomous Mode (Recommended)

Start a task that runs autonomously until complete:

```bash
cd ~/Projects/my-app
agx claude --autonomous -p "Build a React todo app with auth"
# ✓ Created task: build-react-todo
# ✓ Mapped: ~/Projects/my-app → task/build-react-todo
# ✓ Daemon started (pid 12345)
# ✓ Autonomous mode: daemon will continue work every 15m
```

This:
1. Creates a mem task branch
2. Starts the agx daemon (if not running)
3. Daemon wakes every 15m to continue work
4. Runs until agent outputs [done] or [blocked]

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
- Stops when task is [done] or [blocked]

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
[pause]                 # Stop, resume on next wake
```

**Default behavior:** Keep working. Only output stopping markers when needed.

## Provider Aliases

| Provider | Aliases | Description |
|----------|---------|-------------|
| claude | c, cl | Anthropic Claude Code |
| gemini | g, gem | Google Gemini |
| ollama | o, oll | Local Ollama |

## Common Flags

```bash
--autonomous, -a    # Create task and run autonomously (starts daemon)
--task NAME         # Specific task name
--criteria "..."    # Success criterion (repeatable)
-y                  # Skip confirmations
```

## Examples

### Quick one-shot
```bash
agx claude -p "Explain this error" -y
```

### Autonomous task
```bash
cd ~/Projects/api
agx claude --autonomous -p "Add user authentication with JWT"
# Daemon continues work every 15m until done
```

### Check on a running task
```bash
agx daemon status   # Check daemon
mem status          # Task summary
mem progress        # % complete
```

### Manual continue
```bash
cd ~/Projects/api
agx claude -p "continue"   # Resume from last checkpoint
```
