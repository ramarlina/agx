# Resolution Worker

## Overview

The Resolution Worker automatically resolves predictions when their lock time is reached. It compares predicted values against actual outcomes and updates prediction status accordingly.

## Architecture

```
┌─────────────────┐
│ ResolutionWorker│
│   (Scheduler)   │
└────────┬────────┘
         │ polls every N seconds
         ↓
┌─────────────────┐
│ PredictionStore │
│  (Data Layer)   │
└─────────────────┘
```

## How It Works

1. **Polling**: Worker runs on a configurable interval (default: 30 seconds)
2. **Query**: Fetches predictions where:
   - Lock time has passed
   - Status is still "pending"
   - Actual outcome has been set
3. **Resolution**: For each prediction:
   - Compare `predictedValue` to `actualOutcome`
   - Update status to "correct" or "incorrect"
   - Set `resolvedAt` timestamp
   - Set `wasCorrect` boolean
4. **Events**: Emit events for monitoring and logging

## Prediction Lifecycle

```
CREATE → PENDING → RESOLVED
  ↓         ↓          ↓
  |    Set outcome  correct/incorrect
  |         |
  |    Lock time reached
  |         ↓
  |    Worker processes
  |         ↓
  |    Status updated
```

## Data Model

### Prediction Object

```javascript
{
  id: "uuid",
  agent: "claude",              // Agent making prediction
  symbol: "ETH",                // Token/entity being predicted
  predictedValue: 3500,         // What was predicted
  actualOutcome: 3520,          // Actual result (set before lock time)
  lockTime: "2026-02-10T12:00:00Z", // When prediction locks
  status: "pending",            // pending | correct | incorrect
  createdAt: "2026-02-10T11:00:00Z",
  resolvedAt: null,             // Set when resolved
  wasCorrect: null,             // true | false | null
  metadata: {}                  // Additional context
}
```

## API Endpoints

### Prediction Management

- `POST /predictions` - Create prediction
- `GET /predictions` - List predictions (with filters)
- `GET /predictions/:id` - Get single prediction
- `PUT /predictions/:id/outcome` - Set actual outcome
- `GET /predictions/stats` - Get statistics

### Worker Management

- `GET /worker/status` - Get worker status

## Usage Examples

### Creating a Prediction

```javascript
POST /predictions
{
  "agent": "claude",
  "symbol": "ETH",
  "predictedValue": 3500,
  "lockTime": "2026-02-10T12:00:00Z",
  "metadata": {
    "confidence": 0.85
  }
}
```

### Setting Outcome

```javascript
PUT /predictions/{id}/outcome
{
  "actualOutcome": 3520
}
```

### Checking Status

```javascript
GET /worker/status

Response:
{
  "success": true,
  "data": {
    "isRunning": true,
    "pollInterval": 30000,
    "nextCheck": "2026-02-10T12:01:00Z"
  }
}
```

## Comparison Logic

### Numeric Values
- Uses 5% tolerance by default
- Prediction: 3500, Actual: 3520 → **Correct** (within 5%)
- Prediction: 3500, Actual: 4000 → **Incorrect** (outside 5%)

### String Values
- Exact match required
- Case-sensitive

### Object/Array Values
- Deep equality via JSON stringification

### Custom Logic
Modify `_comparePredictionToOutcome()` in `ResolutionWorker` to customize comparison logic.

## Events

The worker emits the following events:

- `started` - Worker started successfully
- `stopped` - Worker stopped
- `predictionResolved` - Single prediction resolved
  ```javascript
  {
    predictionId: "uuid",
    status: "correct",
    isCorrect: true,
    resolvedAt: "2026-02-10T12:00:05Z"
  }
  ```
- `batchComplete` - Batch processing complete
  ```javascript
  {
    processed: 5,
    correct: 3,
    incorrect: 2,
    errors: 0
  }
  ```
- `error` - Error occurred
- `resolutionError` - Error resolving specific prediction

## Testing

Run the test script to see the worker in action:

```bash
cd todo-api
node test-resolution-worker.js
```

This creates sample predictions with short lock times and demonstrates automatic resolution.

## Configuration

Configure the worker at initialization:

```javascript
const worker = new ResolutionWorker({
  dataStore: predictionStore,
  pollInterval: 30000  // 30 seconds (default: 60000)
});
```

## Integration

The worker is automatically started when the server starts:

```javascript
// In server.js
const predictionStore = new PredictionStore();
const resolutionWorker = new ResolutionWorker({
  dataStore: predictionStore,
  pollInterval: 30000
});

// Start on server boot
app.listen(PORT, () => {
  resolutionWorker.start();
});

// Stop on shutdown
process.on('SIGTERM', () => {
  resolutionWorker.stop();
  process.exit(0);
});
```

## Production Considerations

1. **Database Backend**: Replace `PredictionStore` in-memory storage with PostgreSQL/Redis
2. **Distributed Locking**: Add distributed locks if running multiple server instances
3. **Error Handling**: Add retry logic and dead letter queue for failed resolutions
4. **Monitoring**: Integrate with metrics system (Prometheus, DataDog, etc.)
5. **Tolerance Tuning**: Adjust numeric comparison tolerance based on domain
6. **Batch Size**: Add batch size limits to prevent memory issues with large datasets
7. **Timezone Handling**: Ensure lock times are stored/compared in UTC

## Mesh Signals Domain

In the context of mesh-signals (multi-agent token prediction):

- **Predictions**: Agents predict token performance
- **Lock Time**: Deadline for making/changing predictions
- **Resolution**: Comparing predictions to actual market data
- **Accuracy Tracking**: Building agent reputation based on prediction accuracy

This worker enables autonomous, time-based resolution of agent predictions without manual intervention.
