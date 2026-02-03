# agx

Unified AI Agent CLI with persistent memory. Wraps Claude, Gemini, and Ollama with automatic state management.

```bash
npm install -g @mndrk/agx
```

## Quick Start

```bash
# Simple prompt
agx -p "explain this code"

# Specific provider
agx claude -p "fix this bug"

# Autonomous mode - creates task + daemon, runs until done
agx -a -p "Build a React todo app with auth"
```

## Task Management

agx handles all persistent state internally:

```bash
# Create a task
agx init myproject "Build a todo app"

# Check status
agx status

# List all tasks
agx tasks

# Continue work (context auto-loaded)
agx -p "continue"

# Mark complete
agx done
```

## Task Commands

```bash
agx init <name> "<goal>"    # Create new task
agx status                  # Show current state
agx tasks                   # List all tasks with schedules
agx done                    # Mark task complete
agx stuck [reason|clear]    # Mark/clear blocker
agx switch <name>           # Switch between tasks
agx checkpoint "<msg>"      # Save progress point
agx learn "<insight>"       # Record learning
agx next "<step>"           # Set next step
agx wake "<schedule>"       # Set wake (e.g. "every 15m")
agx progress                # Show % complete
agx criteria add "<text>"   # Add success criterion
agx criteria <N>            # Mark criterion #N complete
```

## Autonomous Mode

Start a task that runs autonomously until complete:

```bash
agx -a -p "Build a REST API with authentication"
# ✓ Created task: build-rest-api
# ✓ Mapped: ~/Projects/api → task/build-rest-api
# ✓ Daemon started (pid 12345)
# ✓ Autonomous mode: daemon will continue work every 15m
```

The `-a` flag:
- Creates a task with your prompt as the goal
- Starts background daemon
- Skips permission prompts (`-y` implied)
- Continues until `[done]` or `[blocked]`

## Daemon

Background runner for unattended work:

```bash
agx daemon start       # Start
agx daemon stop        # Stop
agx daemon status      # Check if running
agx daemon logs        # View recent logs
```

## Output Markers

Agents control state via markers in their output:

```
[checkpoint: Hero section complete]   # Save progress
[learn: Tailwind is fast]             # Record learning
[next: Add auth system]               # Set next step
[criteria: 2]                         # Mark criterion #2 done
```

Stopping markers (only when needed):
```
[done]                                # Task complete
[blocked: Need API key from client]   # Can't proceed
[approve: Deploy to production?]      # Need human ok
```

## Providers

| Provider | Aliases | Description |
|----------|---------|-------------|
| claude | c, cl | Anthropic Claude Code |
| gemini | g, gem | Google Gemini CLI |
| ollama | o, ol | Local Ollama models |

## Options

```
--prompt, -p <text>    Prompt to send
--model, -m <name>     Model name
--yolo, -y             Skip permission prompts
--autonomous, -a       Create task + daemon, run unattended
--task <name>          Specific task name
--criteria <text>      Success criterion (repeatable)
--print                Non-interactive output
--interactive, -i      Force interactive mode
```

## Setup Commands

```bash
agx setup              # First-time setup wizard
agx config             # Configuration menu
agx add <provider>     # Install a provider
agx login <provider>   # Authenticate
agx skill              # View agx skill (for LLMs)
agx skill install      # Install skill to Claude/Gemini
```

## Claude Code Plugin

Install as a Claude Code plugin:

```bash
claude plugin install github:ramarlina/agx
```

## Example: Full Workflow

```bash
# Day 1: Start project
mkdir ~/Projects/my-app && cd ~/Projects/my-app
agx init todo-app "Build a React todo app with auth"
agx criteria add "CRUD operations working"
agx criteria add "Auth with JWT"
agx criteria add "Deployed to Vercel"
agx -p "Let's build this"

# Agent works, saves progress automatically
# [checkpoint: Scaffolded with Vite]
# [learn: Vite is faster than CRA]
# [next: Add todo list component]

# Day 2: Continue
cd ~/Projects/my-app
agx -p "continue"
# Context auto-loaded, picks up where it left off

# Check progress
agx progress
# Progress: 33% (1/3 criteria complete)

# Mark done when finished
agx done
```

## License

MIT
