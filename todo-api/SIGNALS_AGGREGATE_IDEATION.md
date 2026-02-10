# Signals Aggregate Worker - Ideation Document

## Overview

This document provides research, scope, and approach for the **signals-aggregate worker** - a periodic aggregation service that computes high-value signal data for the mesh-signals project.

## 1. Scope

### What Needs to Be Built

A background worker that runs **every 5 minutes** to compute and cache four types of aggregated signals:

1. **gems**: Predictions with the biggest multiples (predicted/actual ratios)
   - Find predictions where agents significantly over/under-predicted
   - Useful for identifying exceptional prediction opportunities

2. **hot_tokens**: Tokens with multi-agent convergence
   - Identify symbols where multiple agents agree (convergence)
   - Measures consensus across different AI models

3. **best_performers**: Top-performing agents by win rate and accuracy
   - Rank agents by success metrics
   - Enable weighted consensus and trust scoring

4. **recent_exits**: Recently resolved predictions
   - Track the latest prediction outcomes
   - Show real-time prediction flow

### Success Criteria

- Worker runs automatically every 5 minutes
- Aggregated data is cached in-memory for fast API access
- API endpoints expose each signal type with filtering/sorting
- Integration with existing worker patterns (ResolutionWorker, ReputationCalcWorker)
- Minimal performance impact on existing services

## 2. Approach

### Architecture Pattern

Based on existing workers in the codebase, the implementation would follow this pattern:

```
SignalsAggregateWorker (EventEmitter)
├── constructor(options)
│   ├── pollInterval: 300000 ms (5 min)
│   ├── dataStore: PredictionStore
│   └── reputationWorker: ReputationCalcWorker
├── start() / stop()
├── _aggregateSignals() [private, runs every 5 min]
│   ├── _computeGems()
│   ├── _computeHotTokens()
│   ├── _computeBestPerformers()
│   └── _computeRecentExits()
└── getSignals() / getSignal(type)
```

### Integration Points

1. **Data Sources**
   - `PredictionStore`: Source for predictions data
   - `ReputationCalcWorker`: Source for agent performance metrics
   - Potentially: external token data (if tracking actual token convergence)

2. **Server Integration** (`server.js`)
   - Instantiate worker with dependencies
   - Start worker on server startup
   - Stop worker on graceful shutdown
   - Wire up API endpoints for each signal type

3. **API Endpoints** (following existing patterns)
   ```
   GET /signals/aggregate              - All signals
   GET /signals/gems                   - Top gems with filters
   GET /signals/hot_tokens_aggregate   - Hot tokens by convergence
   GET /signals/best_performers_aggregate - Top agents
   GET /signals/recent_exits           - Recent predictions
   GET /workers/signals-aggregate/status - Worker health
   ```

### Data Computation Logic

#### 1. Gems (Biggest Multiples)
- Query all resolved predictions
- Filter for numeric predictions only
- Calculate `multiple = predictedValue / actualOutcome`
- Sort by absolute deviation from 1.0 (both over and under predictions)
- Cache top N (e.g., 100) with metadata

#### 2. Hot Tokens (Multi-Agent Convergence)
- Group predictions by symbol
- For each symbol, count unique agents
- Calculate convergence score based on:
  - Number of agents predicting the symbol
  - Proximity of their predictions
  - Recency of predictions
- Sort by convergence strength

**Unknowns:**
- What defines "convergence"? Same direction? Within X% of each other?
- Should we weight by agent reputation?

#### 3. Best Performers
- Leverage `ReputationCalcWorker.getAllReputations()`
- Sort by win rate, accuracy, or composite score
- Apply filters (minimum predictions threshold)
- Cache top N performers

#### 4. Recent Exits
- Query predictions with `status !== 'pending'`
- Sort by `resolvedAt` descending
- Include outcome, accuracy, agent, symbol
- Cache last N (e.g., 50-100) entries

### In-Memory Cache Structure

```javascript
this.cache = {
  gems: [
    { id, agent, symbol, predictedValue, actualOutcome, multiple, resolvedAt }
  ],
  hot_tokens: [
    { symbol, name, convergence, agents[], score, lastUpdated }
  ],
  best_performers: [
    { agent, winRate, avgMultiple, totalCalls, convergenceRate }
  ],
  recent_exits: [
    { id, agent, symbol, outcome, status, resolvedAt }
  ],
  lastUpdated: ISO_timestamp
}
```

## 3. Effort Estimate

### Complexity: **Medium**

#### Components Breakdown

| Component | Complexity | Reason |
|-----------|-----------|--------|
| Worker scaffold | Low | Pattern exists (ResolutionWorker, ReputationCalcWorker) |
| Gems computation | Low | Simple math on numeric predictions |
| Hot tokens computation | Medium | Requires convergence logic definition |
| Best performers | Low | Delegates to ReputationCalcWorker |
| Recent exits | Low | Simple query + sort |
| API endpoints | Low | Follow existing pattern from server.js |
| Testing | Medium | Need to simulate prediction scenarios |

#### Estimated Work

- **Worker implementation**: 2-3 hours
- **API integration**: 1 hour
- **Testing**: 1-2 hours
- **Documentation**: 1 hour

**Total: 5-7 hours**

### Dependencies

- ✅ PredictionStore (exists)
- ✅ ReputationCalcWorker (exists)
- ✅ ResolutionWorker (exists for lifecycle events)
- ⚠️ Token metadata (name, symbol mappings) - may need stub data

## 4. Unknowns & Questions

### Critical Questions

1. **Convergence Definition**
   - How do we measure "multi-agent convergence"?
   - Is it just: "number of agents predicting the same symbol"?
   - Or: "agents predicting similar values (within X%)"?
   - Should we weight by agent reputation?

2. **Data Sources**
   - Where does token metadata come from (name, symbol)?
   - Currently, `server.js` has hardcoded tokens (ETH, USDC, LINK, ARB)
   - Should we derive from predictions or maintain a token registry?

3. **Gems Criteria**
   - What makes a prediction a "gem"?
   - Highest absolute multiple? Or highest positive multiple only?
   - Include both over and under predictions?

4. **Performance Considerations**
   - With thousands of predictions, will 5-minute aggregation cause latency?
   - Should we implement pagination limits on cache size?
   - Do we need incremental updates or full recalculation?

5. **Recent Exits Window**
   - How many recent exits to cache? Last 50? 100? 24 hours?
   - Should this be configurable?

### Technical Decisions

1. **Token convergence calculation**
   - **Option A**: Count unique agents per symbol (simple)
   - **Option B**: Calculate prediction variance per symbol (complex)
   - **Recommendation**: Start with A, enhance with B later

2. **Cache invalidation**
   - **Option A**: Full recalculation every 5 minutes
   - **Option B**: Listen to events and update incrementally
   - **Recommendation**: A for MVP (simpler), B for optimization

3. **API response size**
   - Should we paginate or limit results by default?
   - **Recommendation**: Apply sensible defaults (top 100), allow limit override

## 5. Similar Patterns in Codebase

### ResolutionWorker Pattern
- Polls on interval (30 seconds)
- Processes batch of predictions
- Emits events on completion
- **Similarity**: Periodic processing, event emission

### ReputationCalcWorker Pattern
- Event-driven updates
- In-memory cache
- Exposes `get*` methods for API
- **Similarity**: Caching aggregated data, API exposure

### Existing Token Signals (server.js:34-72)
```javascript
const tokenSignals = new Map([
  ['ETH', {
    symbol: 'ETH',
    name: 'Ethereum',
    convergence: 3,
    agents: ['claude', 'gemini', 'ollama'],
    score: 1.0
  }]
]);
```
- **Note**: This is hardcoded mock data
- Worker should **compute this dynamically** from prediction data

## 6. Testing Strategy

### Test Scenarios

1. **Worker Lifecycle**
   - Start/stop functionality
   - Interval-based execution
   - Graceful shutdown

2. **Gems Computation**
   - Create predictions with varying multiples
   - Verify top gems are correctly identified
   - Test sorting and filtering

3. **Hot Tokens**
   - Multiple agents predict same symbol → high convergence
   - Single agent predicts symbol → low convergence
   - Verify convergence scoring

4. **Best Performers**
   - Verify delegation to ReputationCalcWorker
   - Test sorting and filtering

5. **Recent Exits**
   - Create and resolve predictions
   - Verify recent ones appear in cache
   - Test limit parameter

### Test Script Pattern
Follow `test-reputation-worker.js` structure:
- Create predictions via API
- Set outcomes
- Wait for resolution + aggregation
- Query aggregated endpoints
- Validate results

## 7. API Design

### Proposed Endpoints

```
GET /signals/aggregate
  → Returns all four signal types in one response
  → Use case: Dashboard overview

GET /signals/gems?limit=10&sort=highest
  → Returns top gems
  → Filters: limit, sort (highest|lowest|recent)

GET /signals/hot_tokens_aggregate?minConvergence=2
  → Returns tokens with ≥N agents
  → Filters: minConvergence, limit

GET /signals/best_performers_aggregate?limit=5&minWinRate=0.7
  → Returns top agents
  → Filters: limit, minWinRate, sortBy (winRate|accuracy|convergenceRate)

GET /signals/recent_exits?limit=20&status=correct
  → Returns recent resolutions
  → Filters: limit, status (correct|incorrect)

GET /workers/signals-aggregate/status
  → Worker health and cache stats
  → Returns: isRunning, lastAggregation, cacheSize, nextRun
```

## 8. Production Considerations

### MVP (Initial Implementation)
- In-memory cache (acceptable for single instance)
- Full recalculation every 5 minutes
- Basic filtering and sorting
- Event logging

### Future Enhancements
- **Redis cache** for multi-instance deployments
- **Incremental updates** via event subscription
- **Webhooks** for signal changes (e.g., new gem detected)
- **Historical tracking** of signals over time
- **Configurable thresholds** (gem threshold, convergence definition)
- **Alerting** when exceptional signals appear

## 9. Risk Assessment

### Low Risk
- ✅ Pattern is well-established in codebase
- ✅ Dependencies exist and are stable
- ✅ Read-only operations (no data mutation)

### Medium Risk
- ⚠️ Convergence logic needs clarification (can start simple)
- ⚠️ Performance with large datasets (can optimize later)

### Mitigation
- Start with simple convergence (agent count)
- Add performance monitoring
- Implement cache size limits

## 10. Implementation Plan (High-Level)

### Phase 1: Core Worker (2-3 hours)
1. Create `workers/signals-aggregate-worker.js`
2. Implement EventEmitter scaffold
3. Add start/stop lifecycle
4. Implement four computation methods
5. Add in-memory cache

### Phase 2: API Integration (1 hour)
1. Update `server.js` to instantiate worker
2. Add 5 new endpoints
3. Wire up worker lifecycle to server startup/shutdown

### Phase 3: Testing (1-2 hours)
1. Create `test-signals-aggregate-worker.js`
2. Test each signal type
3. Validate API responses
4. Test edge cases (empty data, single prediction, etc.)

### Phase 4: Documentation (1 hour)
1. Create `SIGNALS_AGGREGATE_SUMMARY.md`
2. Update `server.js` endpoint comments
3. Add JSDoc comments to worker

## 11. Key Decisions Needed Before Implementation

Before moving to the **plan** stage, clarify:

1. **Convergence definition**: Simple agent count or value proximity?
2. **Gem criteria**: Both over and under predictions, or positive multiples only?
3. **Cache size limits**: Max entries per signal type?
4. **Token metadata source**: Hardcoded list or derive from predictions?

## Conclusion

The signals-aggregate worker is a **well-scoped, medium-complexity task** that follows established patterns in the codebase. The main unknowns relate to business logic (convergence definition, gem criteria) rather than technical implementation.

**Recommendation**: Proceed to planning stage after clarifying the key decisions above. Implementation is straightforward given existing worker patterns.

### Estimated Total Effort
- **Development**: 5-7 hours
- **Complexity**: Medium
- **Risk**: Low-Medium
- **Dependencies**: All exist

**Status**: Ready for planning phase once business logic is clarified.
