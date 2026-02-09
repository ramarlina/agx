# /agx:daemon - Manage Local Cloud Worker

Control the agx daemon that polls AGX Cloud queue and executes tasks locally.

## Usage
```
/agx:daemon <action>
```

## Actions
- `start` - Start the daemon
- `stop` - Stop the daemon
- `status` - Check if running
- `logs` - Show recent logs

## Implementation

```bash
# Check status
agx daemon status

# Start if needed
agx daemon start

# Set execution worker count
agx daemon start -w 6

# View logs
agx daemon logs

# Stop when done
agx daemon stop
```

The daemon:
- Runs in background (survives terminal close)
- Executes agent work locally with access to your machine
- Uses AGX Cloud API for queue pull + stage completion
- Optionally launches the embedded orchestrator worker (`npm run daemon:worker`) when running the local board runtime; logs to `~/.agx/orchestrator-worker.log`.
