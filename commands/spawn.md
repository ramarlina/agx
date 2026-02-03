# /agx:spawn - Start Autonomous Task

Spawn an autonomous agent task that runs until complete.

## Usage
```
/agx:spawn <goal>
```

## Arguments
- `$ARGUMENTS` - The goal/task description for the agent

## Implementation

First, ensure you're in the correct project directory, then:

```bash
agx claude --autonomous -p "$ARGUMENTS"
```

This will:
1. Create a mem task branch
2. Start the agx daemon (if not running)
3. Begin working on the task
4. Daemon wakes every 15m to continue until [done]

Check status with:
```bash
agx daemon status
mem status
```
