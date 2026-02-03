# agx

Autonomous AI agents. One command, works until done.

```bash
npm install -g @mndrk/agx
```

## Quick Start

```bash
agx -a -p "Build a REST API with auth"
# ✓ Created task: build-rest-api  
# ✓ Daemon started (wakes every 15m)
# ✓ Working...
```

That's it. The agent continues working autonomously until complete.

## How It Works

The `-a` flag starts an autonomous task:
1. Creates a task from your prompt
2. Starts background daemon
3. Agent works on the task
4. Wakes every 15 minutes to continue
5. Stops when agent outputs `[done]` or `[blocked]`

No manual task management. No babysitting. Just results.

## Checking Progress

```bash
agx status          # Current task
agx tasks           # All tasks
agx progress        # % complete
agx daemon logs     # Recent activity
```

## One-Shot Mode

For quick questions without persistence:

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

## Output Markers

Agents control their state via markers:

```
[checkpoint: Built login page]    # Save progress
[learn: JWT works better here]    # Record insight
[next: Add signup flow]           # Set next step
[done]                            # Task complete
[blocked: Need API key]           # Can't proceed
```

## Manual Control (Optional)

For power users who want fine control:

```bash
agx run [task]        # Run task now
agx pause [task]      # Pause scheduled runs
agx stop [task]       # Mark done
agx stuck <reason>    # Mark blocked
```

## Setup

First run walks you through setup:

```bash
agx setup             # Install providers, set defaults
agx add claude        # Add a provider
agx login claude      # Authenticate
```

## License

MIT
