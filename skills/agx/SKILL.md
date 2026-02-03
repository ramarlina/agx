# agx - Unified AI Agent Wrapper

Use `agx` to run AI agents (Claude Code, Gemini, Ollama) with persistent memory integration. Spawn background tasks that wake automatically and continue working.

## When to Use

- **Spawning background agents** for long-running tasks
- **Auto-task creation** with wake schedules
- **Running different AI providers** with unified interface
- **Autonomous work loops** that continue until done

## Basic Usage

```bash
agx claude -p "prompt"              # Run Claude Code
agx gemini -p "prompt"              # Run Gemini
agx ollama -p "prompt"              # Run Ollama (local)
```

## Auto-Task Mode (Recommended)

Create a task with automatic wake schedule:

```bash
cd ~/Projects/my-app
agx claude --auto-task -p "Build a React todo app with auth"
# ✓ Created task: build-react-todo
# ✓ Mapped: ~/Projects/my-app → task/build-react-todo
# ✓ Wake: every 15m (until done)
```

This:
1. Creates a mem task branch
2. Sets wake schedule (every 15m)
3. Installs cron to continue automatically
4. Agent works until [done] or [blocked]

## Wake Loop

```
WAKE (cron) → Load context → Agent works → Save state → SLEEP
                                                    ↓
                                        repeat until [done]
```

Install the wake schedule:
```bash
mem cron export                          # View entry
(crontab -l; mem cron export) | crontab - # Install
```

## Output Markers

Use these in agent output to control the loop:

### Progress (parsed automatically)
```
[checkpoint: message]   # Save progress point
[learn: insight]        # Record learning
[next: step]            # Set next step
[criteria: N]           # Mark criterion #N complete
```

### Stopping Markers
```
[done]                  # Task complete, clear wake, stop
[blocked: reason]       # Need human help, pause loop
[approve: question]     # Need approval, wait
[pause]                 # Stop, resume on next wake
```

### Loop Control
```
[continue]              # Keep going (--daemon mode loops locally)
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
--auto-task         # Auto-create task from prompt
--task NAME         # Specific task name
--criteria "..."    # Success criterion (repeatable)
--daemon            # Loop on [continue] marker
--until-done        # Keep running until [done]
-y                  # Skip confirmations
```

## Examples

### Quick one-shot
```bash
agx claude -p "Explain this error" -y
```

### Background task with wake
```bash
cd ~/Projects/api
agx claude --auto-task -p "Add user authentication with JWT"
# Agent works, saves progress, wakes every 15m to continue
```

### Check on a running task
```bash
mem status          # Quick summary
mem progress        # % complete
mem context         # Full state dump
```

### Manual continue
```bash
cd ~/Projects/api
agx claude -p "continue"   # Resume from last checkpoint
```
