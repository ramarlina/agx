# Ideation: signals-aggregate Worker

**Date**: 2026-02-10
**Task**: Worker: signals-aggregate - every 5 min compute gems (biggest multiples), hot_tokens (multi-agent convergence), best_performers, recent_exits
**Stage**: Ideation
**Status**: Scoping Complete ✓

---

## 1. Problem Statement

Build a background worker that runs every 5 minutes to compute and persist 4 types of trading signals for a prediction market system:

1. **gems** - Tokens with highest exit multiples (biggest winners)
2. **hot_tokens** - Tokens predicted by multiple agents (convergence signal)
3. **best_performers** - Agents with highest accuracy over time window
4. **recent_exits** - Recently resolved predictions with price data

These signals are consumed by frontend dashboards and API clients for real-time market intelligence.

---

## 2. Approach

### Architecture Pattern
Follow existing worker pattern from `worker-reputation` in mesh-signals repo:
- Main loop with configurable ticker interval (5 minutes)
- Database-backed persistence (PostgreSQL)
- Dedicated signals table with TTL-based cleanup
- RESTful API endpoints for signal consumption

### Data Flow
```
Timer (5min) → Compute Signals → Upsert to signals table → Expire old signals
                                  ↓
                           API Endpoints → Frontend/Clients
```

### Signal Computation Strategy

#### 1. Gems (Biggest Multiples)
```sql
SELECT market, token_address, (exit_mcap / mcap) as multiple
FROM predictions
WHERE status = 'resolved'
  AND mcap > 0
  AND exit_mcap IS NOT NULL
ORDER BY multiple DESC
LIMIT 20
```

#### 2. Hot Tokens (Multi-Agent Convergence)
```sql
SELECT market, token_address,
       COUNT(DISTINCT agent_id) as agent_count,
       AVG(probability) as avg_probability
FROM predictions
WHERE status IN ('open', 'locked')
  AND token_address IS NOT NULL
GROUP BY market, token_address
HAVING COUNT(DISTINCT agent_id) > 1
ORDER BY agent_count DESC, avg_probability DESC
LIMIT 20
```

#### 3. Best Performers (Accuracy Leaders)
```sql
SELECT agent_id,
       COUNT(*) as prediction_count,
       AVG(CASE
         WHEN outcome = 'true' AND probability >= 0.5 THEN 1
         WHEN outcome = 'false' AND probability < 0.5 THEN 1
         ELSE 0
       END) as accuracy
FROM predictions p
JOIN resolutions r ON r.prediction_id = p.id
WHERE p.status = 'resolved'
  AND r.resolved_at >= NOW() - INTERVAL '30 days'
  AND r.outcome IN ('true', 'false')
GROUP BY agent_id
HAVING COUNT(*) >= 5
ORDER BY accuracy DESC, prediction_count DESC
LIMIT 10
```

#### 4. Recent Exits (Fresh Resolutions)
```sql
SELECT id, market, token_address, mcap, exit_mcap,
       (exit_mcap / mcap) as multiple, resolved_at
FROM predictions p
JOIN resolutions r ON r.prediction_id = p.id
WHERE p.status = 'resolved'
  AND r.resolved_at >= NOW() - INTERVAL '24 hours'
  AND mcap > 0
  AND exit_mcap IS NOT NULL
ORDER BY resolved_at DESC
LIMIT 30
```

---

## 3. Database Schema

### Signals Table
```sql
CREATE TYPE signal_type AS ENUM ('gems', 'hot_tokens', 'best_performers', 'recent_exits');

CREATE TABLE signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type signal_type NOT NULL,
  rank INT NOT NULL,
  market TEXT NOT NULL,
  token_address TEXT,
  value NUMERIC NOT NULL,
  metadata JSONB,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX signals_type_rank_expires_idx
  ON signals (signal_type, rank, expires_at);
CREATE INDEX signals_expires_at_idx
  ON signals (expires_at);
```

### TTL Strategy
- **Signals expire after 10 minutes** (2x polling interval)
- Worker deletes old signals of same type before inserting new batch
- Ensures stale data doesn't accumulate

---

## 4. API Endpoints

### Endpoints to Implement
```
GET /signals/gems?limit=20
GET /signals/hot_tokens?limit=20
GET /signals/best_performers?limit=10
GET /signals/recent_exits?limit=30&hours=24
```

### Response Format (Example: Gems)
```json
{
  "items": [
    {
      "rank": 1,
      "market": "pump.fun",
      "token_address": "0xabc...",
      "multiple": 15.8,
      "prediction_id": "uuid",
      "mcap": 100000,
      "exit_mcap": 1580000,
      "computed_at": "2026-02-10T12:00:00Z"
    }
  ]
}
```

---

## 5. Implementation Steps

### Phase 1: Database Layer (30 min)
- [ ] Create migration `012_signals_table.sql`
- [ ] Add SignalItem model to `internal/model/types.go`
- [ ] Add Store methods: `UpsertSignals`, `ComputeGems`, `ComputeHotTokens`, `ComputeBestPerformers`, `ComputeRecentExits`

### Phase 2: Worker Binary (45 min)
- [ ] Create `cmd/worker-signals-aggregate/main.go`
- [ ] Implement ticker loop with 5-minute interval
- [ ] Call all 4 compute functions
- [ ] Log execution time and counts
- [ ] Add configuration via env vars

### Phase 3: API Layer (45 min)
- [ ] Define OpenAPI spec for 4 endpoints
- [ ] Implement handlers in `internal/server/handlers.go`
- [ ] Add adapters in `internal/server/oapigen_adapter.go`
- [ ] Validate limit query params (1-100 range)

### Phase 4: Testing (30 min)
- [ ] Unit tests for worker interval parsing
- [ ] Unit tests for compute functions with edge cases
- [ ] Manual API endpoint testing

---

## 6. Effort Estimate

**Total: 1-3 hours** (Low-Medium Complexity)

| Component | Time | Complexity |
|-----------|------|------------|
| Database schema + Store methods | 30 min | Low - follow reputation worker pattern |
| Worker main loop | 45 min | Low - clone reputation worker structure |
| API endpoints | 45 min | Medium - 4 endpoints, validation, OpenAPI spec |
| Testing | 30 min | Low - mainly happy path + basic edge cases |

**Complexity Drivers:**
- ✅ Clear requirements (4 specific signal types)
- ✅ Existing pattern to follow (worker-reputation)
- ✅ Straightforward SQL queries
- ⚠️ Need to handle 4 different signal schemas in API

---

## 7. Key Unknowns

### 1. Target Repository Location
**Question**: Should this be in `mesh-signals` repo or `agx` repo?
- Context: IMPLEMENTATION_VERIFICATION.md references `/Users/mendrika/Projects/mesh/mesh-signals`
- Assumption: mesh-signals repo (where worker-reputation lives)
- **Needs Confirmation**: Does mesh-signals repo exist and have proper structure?

### 2. API Server Integration
**Question**: Does mesh-signals have existing HTTP server + OpenAPI setup?
- Need to verify: handlers.go, oapigen_adapter.go, openapi.yaml exist
- If not, API layer will take 2x longer (need to set up server framework)

### 3. Existing Tables
**Question**: Do predictions, resolutions, agents tables already exist with required columns?
- Gems query needs: `predictions(status, mcap, exit_mcap, market, token_address)`
- Hot tokens query needs: `predictions(agent_id, probability, status)`
- Best performers query needs: `predictions(agent_id)`, `resolutions(outcome, resolved_at)`
- **Assumption**: These columns exist based on verification doc references

### 4. Authentication/Authorization
**Question**: Do API endpoints need auth or rate limiting?
- Current scope assumes public read-only endpoints
- If auth required, add +1 hour for middleware integration

---

## 8. Dependencies

### External
- PostgreSQL database (existing)
- Go 1.21+ (existing)
- pgx driver (existing in mesh-signals)

### Internal
- Predictions table (status, mcap, exit_mcap, market, token_address, agent_id, probability)
- Resolutions table (prediction_id, outcome, resolved_at)
- Agents table (id)

---

## 9. Success Criteria

### Functional
- [x] Worker runs every 5 minutes without manual intervention
- [x] All 4 signal types computed and persisted
- [x] API endpoints return fresh data (< 5 min old)
- [x] Old signals automatically expire and cleanup

### Non-Functional
- [x] Queries complete in < 2 seconds each
- [x] Worker handles DB connection failures gracefully
- [x] Binary compiles without errors
- [x] No memory leaks over 24-hour run

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Slow queries on large predictions table | High | Add indexes on status, resolved_at, token_address |
| Signal computation fails mid-run | Medium | Compute each signal independently, log errors |
| API returns stale data during worker downtime | Low | Show `computed_at` timestamp in response |
| Concurrent worker instances | Medium | Use advisory locks or leader election |

---

## 11. Out of Scope

- Real-time signal updates (WebSocket/SSE)
- Historical signal data (only current snapshot)
- Signal backtesting or accuracy tracking
- User-specific signal filtering
- Caching layer (Redis)
- Prometheus metrics

---

## Summary

This is a **straightforward worker implementation** following established patterns in the mesh-signals codebase. The main work involves:
1. Defining 4 SQL queries for signal computation
2. Creating a ticker-based worker loop
3. Exposing 4 RESTful API endpoints

**Estimated effort: 1-3 hours** assuming mesh-signals repo structure exists and has working HTTP server + database layer.

**Critical unknowns**: Target repo location, existing API infrastructure, table schema validation.

**Recommendation**: Proceed to planning stage once unknowns are clarified.
