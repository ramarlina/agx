# /agx:spawn - Spawn Background Agent

Spawn a background agent task with automatic wake schedule.

## Usage
```
/agx:spawn <goal>
```

## Arguments
- `$ARGUMENTS` - The goal/task description for the agent

## Implementation

First, ensure you're in the correct project directory, then:

```bash
agx claude --auto-task -p "$ARGUMENTS"
```

This will:
1. Create a mem task branch
2. Set wake schedule (every 15m)
3. Start the agent working

After spawning, install the wake cron:
```bash
(crontab -l 2>/dev/null; mem cron export) | crontab -
```

Report the task name and confirm wake schedule is set.
