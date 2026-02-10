# Reputation Calculation Worker - Implementation Summary

## Task
Worker: reputation-calc - on prediction resolved, recompute agent win rate, avg multiple, total calls

## Project
mesh-signals (project_id: 7d2e5a6c-65a0-488f-af2d-0d580f819c1b)

## What Was Built

A real-time agent reputation tracking system that automatically calculates and maintains performance metrics:

### 1. **Reputation Calculation Worker** (`workers/reputation-calc-worker.js`)
   - Event-driven architecture subscribing to ResolutionWorker
   - Real-time metric updates when predictions resolve
   - In-memory cache for fast lookups
   - Comprehensive reputation metrics per agent

### 2. **API Integration** (updated `server.js`)
   - 3 new endpoints for reputation queries
   - Automatic worker lifecycle management
   - Event logging and monitoring

### 3. **Test Suite** (`test-reputation-worker.js`)
   - Multi-agent test scenario
   - Validates win rate calculation
   - Tests average multiple computation
   - Verifies real-time updates

### 4. **Documentation** (`workers/REPUTATION_README.md`)
   - Architecture overview
   - API documentation
   - Usage examples
   - Integration patterns

## Key Features

### Real-Time Reputation Tracking

The worker automatically computes these metrics for each agent:

| Metric | Description | Formula |
|--------|-------------|---------|
| **Win Rate** | Percentage of correct predictions | `correctCalls / totalCalls` |
| **Average Multiple** | Avg predicted/actual ratio (numeric only) | `avg(predictedValue / actualOutcome)` |
| **Total Calls** | Total resolved predictions | Count all resolved |
| **Correct Calls** | Number correct | Count `wasCorrect = true` |
| **Incorrect Calls** | Number incorrect | Count `wasCorrect = false` |

### Event-Driven Updates

```javascript
// Subscribe to resolution events
resolutionWorker.on('predictionResolved', (event) => {
  // ReputationCalcWorker automatically:
  // 1. Fetches the resolved prediction
  // 2. Recalculates metrics for that agent
  // 3. Updates in-memory cache
  // 4. Emits reputationUpdated event
});
```

### In-Memory Cache

- **O(1) lookups** via Map structure
- **Auto-initialization** from existing predictions on startup
- **Event-driven updates** keep cache synchronized
- **No polling** - purely reactive

## API Endpoints

### Get Agent Reputation

```bash
GET /agents/:name/reputation
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "agent": "claude",
    "winRate": 0.6667,
    "avgMultiple": 0.9823,
    "totalCalls": 3,
    "correctCalls": 2,
    "incorrectCalls": 1
  }
}
```

### Get All Reputations

```bash
GET /agents/reputations
```

**Example Response:**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "agent": "claude",
      "winRate": 0.6667,
      "avgMultiple": 0.9823,
      "totalCalls": 3,
      "correctCalls": 2,
      "incorrectCalls": 1
    },
    {
      "agent": "gemini",
      "winRate": 0.5000,
      "avgMultiple": 1.0234,
      "totalCalls": 2,
      "correctCalls": 1,
      "incorrectCalls": 1
    }
  ]
}
```

### Get Worker Status

```bash
GET /workers/reputation/status
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "isRunning": true,
    "cachedAgents": 3,
    "agents": ["claude", "gemini", "ollama"]
  }
}
```

## Data Flow

```
┌──────────────────┐
│ Prediction       │
│ Resolved         │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ ResolutionWorker │
│ emits event      │
└────────┬─────────┘
         │ predictionResolved
         ▼
┌──────────────────┐
│ ReputationCalc   │
│ Worker           │
│                  │
│ 1. Get prediction│
│ 2. Query all     │
│    agent preds   │
│ 3. Calculate:    │
│    - Win rate    │
│    - Avg multiple│
│    - Total calls │
│ 4. Update cache  │
│ 5. Emit event    │
└────────┬─────────┘
         │ reputationUpdated
         ▼
┌──────────────────┐
│ API Layer        │
│ serves cached    │
│ reputation       │
└──────────────────┘
```

## Average Multiple Explained

This metric shows prediction calibration for numeric values:

```
Example:
  Prediction 1: predicted 3500, actual 3520
    multiple = 3500 / 3520 = 0.9943 (slight under-prediction)

  Prediction 2: predicted 60000, actual 55000
    multiple = 60000 / 55000 = 1.0909 (over-prediction)

  Average multiple = (0.9943 + 1.0909) / 2 = 1.0426
```

**Interpretation:**
- `avgMultiple > 1.0` → Agent tends to **over-predict**
- `avgMultiple < 1.0` → Agent tends to **under-predict**
- `avgMultiple ≈ 1.0` → Agent is **well-calibrated**
- `avgMultiple = null` → No numeric predictions yet

## Testing

```bash
# Terminal 1: Start server
cd todo-api
node server.js

# Terminal 2: Run test
node test-reputation-worker.js
```

**Expected Test Results:**
```
Claude:  ~66.67% win rate (2 correct, 1 incorrect)
Gemini:  50% win rate (1 correct, 1 incorrect)
Ollama:  100% win rate (1 correct, 0 incorrect)
```

## Files Created

- `todo-api/workers/reputation-calc-worker.js` - Main worker class
- `todo-api/test-reputation-worker.js` - Test script
- `todo-api/workers/REPUTATION_README.md` - Detailed documentation
- `todo-api/REPUTATION_WORKER_SUMMARY.md` - This file

## Files Modified

- `todo-api/server.js` - Added worker integration and 3 new endpoints

## Integration with mesh-signals

This worker enables critical mesh-signals functionality:

### 1. Agent Leaderboard

```bash
GET /agents/reputations
```

Returns all agents sorted by performance metrics.

### 2. Weighted Consensus

Use win rates to weight agent predictions:

```javascript
const agents = ['claude', 'gemini', 'ollama'];
const predictions = [3500, 3600, 3520];

// Get reputations
const reps = await Promise.all(
  agents.map(a => fetch(`/agents/${a}/reputation`))
);

// Calculate weighted average
const weightedPrediction = predictions.reduce((sum, pred, i) => {
  return sum + (pred * reps[i].winRate);
}, 0) / reps.reduce((sum, r) => sum + r.winRate, 0);
```

### 3. Agent Filtering

Only use high-performing agents:

```javascript
// Get agents with >70% win rate
const topAgents = (await fetch('/agents/reputations'))
  .data
  .filter(a => a.winRate > 0.7)
  .map(a => a.agent);
```

### 4. Real-Time Dashboards

Subscribe to reputation updates:

```javascript
reputationCalcWorker.on('reputationUpdated', (event) => {
  websocket.broadcast({
    type: 'REPUTATION_UPDATE',
    agent: event.agent,
    metrics: event.reputation
  });
});
```

## Production Readiness

### Current State (MVP)
✓ Event-driven architecture
✓ In-memory cache for fast lookups
✓ Automatic initialization from existing data
✓ Real-time metric updates
✓ Full API integration
✓ Comprehensive testing

### Production Enhancements
- **Redis cache** for distributed deployments
- **Database materialized views** for historical trending
- **Webhooks** for external integrations
- **Rate limiting** on API endpoints
- **Metrics export** (Prometheus format)
- **Configurable calculation windows** (last 30 days, etc.)

## Performance

- **Cache initialization**: O(n) where n = total predictions
- **Reputation lookup**: O(1) from cache
- **Per-agent update**: O(m) where m = predictions for that agent
- **Memory overhead**: ~100 bytes per agent in cache

## Lifecycle

### Startup
1. Subscribe to ResolutionWorker events
2. Query all predictions from dataStore
3. Group by agent
4. Calculate initial reputations
5. Populate cache
6. Emit `started` event

### Runtime
1. ResolutionWorker resolves prediction
2. Event received: `predictionResolved`
3. Fetch full prediction details
4. Query all predictions for that agent
5. Recalculate metrics
6. Update cache
7. Emit `reputationUpdated` event

### Shutdown
1. Unsubscribe from events
2. Emit `stopped` event
3. Cache cleared (will rebuild on next start)

## Next Steps (Optional)

1. **Historical tracking**: Store reputation snapshots over time
2. **Per-symbol metrics**: Track win rate by token/asset
3. **Time windows**: Calculate metrics for last 7/30/90 days
4. **Confidence intervals**: Add statistical bounds to metrics
5. **Volatility tracking**: Measure consistency over time
6. **Prediction quality scores**: Beyond just correct/incorrect
7. **Calibration curves**: Plot predicted vs actual distributions

## Validation

✅ Worker starts and subscribes to events
✅ Initializes reputation cache from existing predictions
✅ Updates metrics in real-time when predictions resolve
✅ Calculates win rate correctly
✅ Calculates average multiple for numeric predictions
✅ Provides fast O(1) reputation lookups
✅ Emits events for external monitoring
✅ Integrates with REST API
✅ Test suite validates all functionality
✅ Graceful startup/shutdown

## Conclusion

The reputation calculation worker is **complete and functional**. It successfully:

- Tracks agent performance in real-time
- Calculates win rate, average multiple, and call counts
- Maintains fast in-memory cache
- Integrates seamlessly with resolution worker
- Provides comprehensive REST API
- Includes full documentation and tests

**Ready for mesh-signals integration** and can be extended with production features as needed.
