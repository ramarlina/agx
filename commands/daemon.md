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
- Also launches the embedded Temporal worker (`npm run daemon:temporal`); see `~/.agx/temporal.log` for its output.
