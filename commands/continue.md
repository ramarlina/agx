# /agx:continue - Continue Current Task

Continue working on the current task from the last checkpoint.

## Usage
```
/agx:continue
```

## Implementation

```bash
agx claude -p "continue"
```

This loads the mem context and continues from where the task left off.
