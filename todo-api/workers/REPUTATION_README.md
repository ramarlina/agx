# Reputation Calculation Worker

## Overview

The Reputation Calculation Worker automatically computes and maintains agent reputation metrics in real-time as predictions are resolved. It subscribes to resolution events and updates agent statistics including win rate, average multiple, and total calls.

## Architecture

```
┌─────────────────────┐
│ ResolutionWorker    │
│                     │
│ - Resolves preds    │
│ - Emits events      │
└──────────┬──────────┘
           │ events
           │ predictionResolved
           │ batchComplete
           ▼
┌─────────────────────┐
│ ReputationCalcWorker│
│                     │
│ - Listens to events │
│ - Recalculates rep  │
│ - Caches metrics    │
└─────────────────────┘
```

## Features

### Event-Driven Updates

The worker subscribes to two events from ResolutionWorker:

1. **predictionResolved** - Single prediction resolved
   - Updates reputation for affected agent
   - Emits `reputationUpdated` event

2. **batchComplete** - Batch of predictions resolved
   - Refreshes all agent reputations
   - Emits `batchReputationUpdated` event

### Reputation Metrics

For each agent, the worker calculates:

| Metric | Description | Calculation |
|--------|-------------|-------------|
| **Win Rate** | Percentage of correct predictions | `correctCalls / totalCalls` |
| **Average Multiple** | Average ratio of predicted/actual (numeric only) | `avg(predictedValue / actualOutcome)` |
| **Total Calls** | Total number of resolved predictions | Count of all resolved predictions |
| **Correct Calls** | Number of correct predictions | Count where `wasCorrect = true` |
| **Incorrect Calls** | Number of incorrect predictions | Count where `wasCorrect = false` |

### In-Memory Cache

The worker maintains a cache of agent reputations in a Map structure:

```javascript
Map<agentName, {
  winRate: number,        // 0.0 to 1.0
  avgMultiple: number,    // Average of predicted/actual (numeric predictions only)
  totalCalls: number,     // Total predictions
  correctCalls: number,   // Correct predictions
  incorrectCalls: number  // Incorrect predictions
}>
```

## Usage

### Initialize Worker

```javascript
import ReputationCalcWorker from './workers/reputation-calc-worker.js';

const reputationCalcWorker = new ReputationCalcWorker({
  dataStore: predictionStore,
  resolutionWorker: resolutionWorker
});

// Start the worker
reputationCalcWorker.start();
```

### Event Handling

```javascript
// Listen for reputation updates
reputationCalcWorker.on('reputationUpdated', (event) => {
  console.log(`Agent ${event.agent} updated:`, event.reputation);
});

reputationCalcWorker.on('batchReputationUpdated', (event) => {
  console.log(`Updated ${event.count} agent reputations`);
});

reputationCalcWorker.on('error', (err) => {
  console.error('Reputation worker error:', err);
});
```

### Get Agent Reputation

```javascript
// Get reputation for specific agent
const reputation = await reputationCalcWorker.getAgentReputation('claude');
console.log(reputation);
// {
//   winRate: 0.6667,
//   avgMultiple: 0.9823,
//   totalCalls: 3,
//   correctCalls: 2,
//   incorrectCalls: 1
// }

// Get all agent reputations
const allReputations = await reputationCalcWorker.getAllReputations();
console.log(allReputations);
// {
//   claude: { winRate: 0.6667, ... },
//   gemini: { winRate: 0.5000, ... },
//   ...
// }
```

### Check Worker Status

```javascript
const status = reputationCalcWorker.getStatus();
// {
//   isRunning: true,
//   cachedAgents: 3,
//   agents: ['claude', 'gemini', 'ollama']
// }
```

## API Endpoints

The worker is integrated with the following REST endpoints:

### Get Agent Reputation

```bash
GET /agents/:name/reputation
```

**Response:**
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

**Response:**
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

**Response:**
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

## How Average Multiple Works

The average multiple metric tracks how close predictions are to actual outcomes for numeric values:

```javascript
// Example predictions:
// Prediction 1: predicted 3500, actual 3520
//   multiple = 3500 / 3520 = 0.9943

// Prediction 2: predicted 60000, actual 55000
//   multiple = 60000 / 55000 = 1.0909

// Average multiple = (0.9943 + 1.0909) / 2 = 1.0426
```

- **avgMultiple > 1.0** = Agent tends to over-predict
- **avgMultiple < 1.0** = Agent tends to under-predict
- **avgMultiple ≈ 1.0** = Agent's predictions are well-calibrated
- **avgMultiple = null** = No numeric predictions yet

## Testing

Run the test script to validate the worker:

```bash
# Start the server
node server.js

# In another terminal, run the test
node test-reputation-worker.js
```

The test will:
1. Create predictions from multiple agents (claude, gemini, ollama)
2. Set actual outcomes
3. Wait for resolution worker to resolve them
4. Check that reputation metrics are calculated correctly

**Expected output:**
```
Claude:  ~66.67% win rate (2 correct, 1 incorrect)
Gemini:  50% win rate (1 correct, 1 incorrect)
Ollama:  100% win rate (1 correct, 0 incorrect)
```

## Lifecycle

### Startup

1. Worker subscribes to ResolutionWorker events
2. Initializes reputation cache from existing predictions
3. Emits `started` event

### Runtime

1. ResolutionWorker resolves a prediction
2. Emits `predictionResolved` event
3. ReputationCalcWorker receives event
4. Fetches all predictions for affected agent
5. Recalculates metrics
6. Updates cache
7. Emits `reputationUpdated` event

### Shutdown

1. Unsubscribes from ResolutionWorker events
2. Emits `stopped` event
3. Cache is cleared (metrics will be recalculated on next start)

## Production Considerations

### Performance

- **Cache First**: Reputation lookups hit the in-memory cache (O(1))
- **Event-Driven**: Only recalculates when predictions resolve
- **Async Operations**: All data store queries are async/await

### Scalability

For production deployments:

1. **Persistent Storage**: Consider persisting reputation cache to Redis
2. **Database Materialized Views**: Use DB views for pre-computed metrics
3. **Batch Processing**: Optimize batch recalculation for large agent sets
4. **Rate Limiting**: Add rate limits on reputation API endpoints

### Reliability

- **Initialization**: Cache is rebuilt from database on startup
- **Event Loss**: If an event is missed, batch processing catches up
- **Error Handling**: Errors are emitted as events, don't crash worker

## Integration with mesh-signals

The reputation worker enables several mesh-signals features:

### Agent Leaderboard

```javascript
// Get all reputations and sort by win rate
const reps = await reputationCalcWorker.getAllReputations();
const sorted = Object.entries(reps)
  .map(([agent, metrics]) => ({ agent, ...metrics }))
  .sort((a, b) => b.winRate - a.winRate);
```

### Weighted Consensus

```javascript
// Weight agent predictions by historical win rate
const agents = ['claude', 'gemini', 'ollama'];
const predictions = [3500, 3600, 3520];

const weights = await Promise.all(
  agents.map(a => reputationCalcWorker.getAgentReputation(a))
);

const weightedAvg = predictions.reduce((sum, pred, i) => {
  return sum + (pred * weights[i].winRate);
}, 0) / weights.reduce((sum, w) => sum + w.winRate, 0);
```

### Agent Filtering

```javascript
// Only use agents with >70% win rate
const highPerformers = Object.entries(
  await reputationCalcWorker.getAllReputations()
)
  .filter(([agent, metrics]) => metrics.winRate > 0.7)
  .map(([agent]) => agent);
```

## Example: Real-Time Dashboard

```javascript
// WebSocket server that pushes reputation updates
reputationCalcWorker.on('reputationUpdated', (event) => {
  wss.broadcast({
    type: 'REPUTATION_UPDATE',
    agent: event.agent,
    reputation: event.reputation,
    timestamp: new Date().toISOString()
  });
});
```

## Files

- `workers/reputation-calc-worker.js` - Main worker implementation
- `test-reputation-worker.js` - Test script
- `workers/REPUTATION_README.md` - This documentation

## See Also

- [Resolution Worker README](./README.md) - Prediction resolution system
- [Prediction Store](../stores/prediction-store.js) - Data store interface
