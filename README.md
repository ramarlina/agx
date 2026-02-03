# agx

Unified AI Agent CLI with persistent memory. Wraps Claude, Gemini, and Ollama with automatic state management via [mem](https://github.com/ramarlina/memx).

```bash
npm install -g @mndrk/agx
```

## Quick Start

```bash
# Simple prompt
agx claude -p "explain this code"

# Use default provider
agx -p "what does this function do?"

# With persistent memory (auto-detected)
agx claude -p "continue working on the todo app"

# Auto-create task (for agents, non-interactive)
agx claude --auto-task -p "Build a todo app with React"
```

## Memory Integration

agx integrates with [mem](https://github.com/ramarlina/memx) for persistent state across sessions:

```bash
# If ~/.mem has a task mapped to cwd, context is auto-loaded
cd ~/Projects/my-app
agx claude -p "continue"   # Knows where it left off

# Create task with explicit criteria
agx claude --task todo-app \
  --criteria "CRUD working" \
  --criteria "Tests passing" \
  --criteria "Deployed to Vercel" \
  -p "Build a todo app"
```

## Output Markers

Agents control state via markers in their output:

```
[checkpoint: Hero section complete]   # Save progress
[learn: Tailwind is fast]             # Record learning
[next: Add auth system]               # Set next step
[criteria: 2]                         # Mark criterion #2 done
[approve: Deploy to production?]      # Halt for approval
[blocked: Need API key from client]   # Mark stuck
[pause]                               # Stop, resume later
[continue]                            # Keep going (daemon)
[done]                                # Task complete
[split: auth "Handle authentication"] # Create subtask
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
--print                Non-interactive output
--interactive, -i      Force interactive mode
--mem                  Enable mem integration (auto-detected)
--no-mem               Disable mem integration
--auto-task            Auto-create task from prompt
--task <name>          Specific task name
--criteria <text>      Success criterion (repeatable)
--daemon               Loop on [continue] marker
```

## Claude Code Plugin

Install as a Claude Code plugin:

```bash
claude plugin install github:ramarlina/agx
```

This adds:
- **Skill**: Claude learns how to spawn background agents
- **Commands**: `/agx:spawn <goal>`, `/agx:continue`

## Commands

```bash
agx init               # Setup wizard
agx config             # Configuration menu
agx status             # Show current config
agx skill              # View LLM skill
agx skill install      # Install skill to Claude/Gemini
```

## Loop Control

The agent controls execution flow via markers:

- `[done]` → Task complete, exit
- `[pause]` → Save state, exit (resume later with same command)
- `[blocked: reason]` → Mark stuck, notify human, exit
- `[continue]` → Keep going (daemon mode loops)
- `[approve: question]` → Halt until human approves

## Task Splitting

Break large tasks into subtasks:

```
Agent output:
This is too big. Breaking it down.

[split: setup "Project scaffolding"]
[split: auth "Authentication system"]
[split: crud "CRUD operations"]
[next: Start with setup subtask]
[pause]
```

agx creates subtask branches in ~/.mem linked to the parent.

## Example: Full Workflow

```bash
# Day 1: Start project
mkdir ~/Projects/my-app && cd ~/Projects/my-app
agx claude --auto-task -p "Build a React todo app with auth"

# Agent works, outputs markers
# [checkpoint: Scaffolded with Vite]
# [learn: Vite is faster than CRA]
# [next: Add todo list component]
# [pause]

# Day 2: Continue
cd ~/Projects/my-app
agx claude -p "continue"
# Context auto-loaded, agent picks up where it left off
```

## License

MIT
