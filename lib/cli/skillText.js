// agx skill - instructions for LLMs on how to use agx

const AGX_SKILL = `---
name: agx
description: Task orchestrator for AI agents. Uses cloud API for persistence.
---

# agx - AI Agent Task Orchestrator

agx manages tasks and coordinates AI agents. Uses cloud API for persistence.

## Quick Start

\`\`\`bash
agx -a -p "Build a REST API"  # Autonomous: works until done
agx -p "explain this code"     # One-shot question
\`\`\`

## Task Lifecycle

\`\`\`bash
agx new "goal"          # Create task
agx run [task]          # Run a task
agx complete <taskId>   # Mark task stage complete
agx status              # Show current status
\`\`\`

## Checking Tasks

\`\`\`bash
agx task ls             # List tasks
agx task logs <id> [-f] # View/tail task logs
agx task tail <id>      # Tail task logs
agx comments tail <id>  # Tail task comments
agx logs tail <id>      # Tail task logs
agx watch               # Watch task updates in real-time (SSE)
\`\`\`

## Cloud

\`\`\`bash
AGX_CLOUD_URL=http://localhost:41741 agx status
AGX_CLOUD_URL=http://localhost:41741 agx task ls
agx daemon start  # Start local daemon
\`\`\`

## Providers

claude (c), gemini (g), ollama (o), codex (x)

## Key Flags

-a  Autonomous mode (daemon + work until done)
-p  Prompt/goal
-y  Skip confirmations (implied by -a)
-P, --provider <c|g|o|x>  Provider for new task (claude/gemini/ollama/codex)
`;

module.exports = { AGX_SKILL };

