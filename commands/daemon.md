# /agx:daemon - Manage Background Daemon

Control the agx daemon that runs autonomous tasks.

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

# View logs
agx daemon logs

# Stop when done
agx daemon stop
```

The daemon:
- Runs in background (survives terminal close)
- Wakes every 15 minutes
- Continues work on active tasks
- Stops tasks when they output [done] or [blocked]
