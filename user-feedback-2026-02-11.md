# User Feedback - Feb 11, 2026

Feature requests from agx user testing session.

## Quick Wins

### 1. Status transitions fix
**Priority:** High  
**Problem:** Task had `completed_at` but status stuck at `in_progress`. Atomic state updates needed.

### 2. `agx status <task>`
**Priority:** Medium  
**Problem:** No quick CLI way to see stage/status/progress without curl.

### 3. Retry with stage reset
**Priority:** Medium  
**Feature:** `agx retry --from ideation` to restart from a specific stage.

---

## Bigger Features

### 4. Parallel workers
**Priority:** Medium  
**Feature:** Run multiple tasks concurrently (`agx daemon -w 4` seems stubbed?)

### 5. Task dependencies
**Priority:** Medium  
**Feature:** "Run this after task X completes"

### 6. Cost tracking
**Priority:** Low  
**Feature:** Track tokens/cost per task, show in `agx task ls`

### 7. Webhooks/notifications
**Priority:** Medium  
**Feature:** Ping a URL or Slack when task completes/fails

---

## Quality of Life

### 8. `agx logs -f <task>`
**Priority:** High  
**Feature:** Live tail of task execution (like `docker logs -f`)

### 9. Task templates
**Priority:** Low  
**Feature:** Presets for common patterns (e.g., "add tests", "refactor X")

### 10. Skip verification stage
**Priority:** Medium  
**Feature:** For simple tasks where `ideation → done` is enough

---

*Captured from user session 2026-02-11*
