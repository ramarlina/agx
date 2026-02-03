# agx - Autonomous AI Agents

Run AI agents that work autonomously until done. One command starts everything.

## Autonomous Mode

```bash
agx -a -p "Build a REST API with auth"
# ✓ Created task: build-rest-api  
# ✓ Daemon started (wakes every 15m)
# ✓ Working...
```

The agent continues working automatically until `[done]` or `[blocked]`.

## One-Shot Mode

For quick questions without persistence:

```bash
agx -p "explain this code"
agx claude -p "fix this bug" -y
```

## Output Markers

Use these in your output to control state:

### Progress (parsed automatically)
```
[checkpoint: message]   # Save progress
[learn: insight]        # Record learning
[next: step]            # Set next step
[criteria: N]           # Mark criterion #N complete
```

### Stopping Markers
```
[done]                  # Task complete, stop
[blocked: reason]       # Need human help, pause
[approve: question]     # Need approval first
```

**Default:** Keep working. Only use stopping markers when genuinely done or stuck.

## Checking Tasks

```bash
agx status          # Current task
agx tasks           # All tasks
agx progress        # % complete
agx daemon logs     # Recent activity
```

## Providers

| Provider | Alias |
|----------|-------|
| claude | c |
| gemini | g |
| ollama | o |

## Key Flags

```bash
-a, --autonomous    # Full auto mode (task + daemon + work until done)
-p, --prompt        # The prompt/goal
-y, --yolo          # Skip confirmations (implied by -a)
```
