# Execution Plan: signals-aggregate Worker

**Date**: 2026-02-10
**Stage**: Planning → Implementation
**Status**: Worker complete, 1 API endpoint remaining

---

## Current Implementation Status

### ✅ Completed Components

1. **Worker Binary** (`/Users/mendrika/Projects/mesh/mesh-signals/cmd/worker-signals-aggregate/main.go`)
   - 5-minute ticker loop
   - Computes all 4 signal types
   - TTL-based cleanup (10 min expiry)
   - Unit tests passing

2. **Database Layer** (`/Users/mendrika/Projects/mesh/mesh-signals/internal/store/postgres.go`)
   - `signals` table with migration
   - `SignalItem` type
   - `UpsertSignals()` method
   - `ComputeGems()` - biggest exit multiples
   - `ComputeHotTokens()` - multi-agent convergence
   - `ComputeBestPerformers()` - highest accuracy agents (30-day window)
   - `ComputeRecentExits()` - recently resolved predictions (24h)

3. **API Endpoints** (3 of 4)
   - ✅ `GET /signals/gems`
   - ✅ `GET /signals/hot_tokens`
   - ✅ `GET /signals/recent_exits`
   - ❌ `GET /signals/best_performers` - **MISSING**

---

## Gap Analysis

### What's Missing

**API Endpoint: GET /signals/best_performers**

The worker computes and stores `best_performers` data, but there's no API endpoint to retrieve it.

Required changes:
1. OpenAPI spec definition
2. Handler function
3. Adapter function
4. Response type definitions

---

## Execution Plan

### Task 1: Add OpenAPI Specification
**File**: `/Users/mendrika/Projects/mesh/mesh-signals/openapi/openapi.yaml`
**Duration**: 10 minutes

Add endpoint definition:
```yaml
/signals/best_performers:
  get:
    operationId: getSignalsBestPerformers
    parameters:
      - name: limit
        in: query
        schema:
          type: integer
          minimum: 1
          maximum: 100
          default: 10
    responses:
      '200':
        content:
          application/json:
            schema:
              type: object
              properties:
                items:
                  type: array
                  items:
                    $ref: '#/components/schemas/BestPerformerSignal'
```

Add schema:
```yaml
BestPerformerSignal:
  type: object
  properties:
    rank:
      type: integer
    agent_id:
      type: string
    prediction_count:
      type: integer
    accuracy:
      type: number
    computed_at:
      type: string
      format: date-time
```

**Dependencies**: None

---

### Task 2: Implement Handler Function
**File**: `/Users/mendrika/Projects/mesh/mesh-signals/internal/httpapi/handlers.go`
**Duration**: 15 minutes

Add handler following pattern of existing signal handlers (gems, hot_tokens):
```go
func (s *Server) getBestPerformersSignals(w http.ResponseWriter, r *http.Request) {
    limit := 10
    if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
        if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
            limit = l
        }
    }

    // Cast to postgres store to access ComputeBestPerformers
    pgStore, ok := s.store.(*store.Postgres)
    if !ok {
        writeJSON(w, http.StatusInternalServerError, ErrorResponse{Error: "server_error", Message: "invalid store type"})
        return
    }

    items, err := pgStore.ComputeBestPerformers(r.Context(), 30, limit)
    if err != nil {
        writeJSON(w, http.StatusInternalServerError, ErrorResponse{Error: "server_error", Message: "failed to load signals"})
        return
    }

    // Transform SignalItem[] to API response format
    performers := make([]BestPerformerSignal, 0, len(items))
    for _, item := range items {
        performers = append(performers, BestPerformerSignal{
            Rank:            item.Rank,
            AgentId:         item.Metadata["agent_id"].(string),
            PredictionCount: int(item.Metadata["prediction_count"].(float64)),
            Accuracy:        item.Value,
            ComputedAt:      item.ComputedAt,
        })
    }

    writeJSON(w, http.StatusOK, map[string]any{"items": performers})
}
```

**Dependencies**: Task 1 (OpenAPI types generated)

---

### Task 3: Implement Adapter Function
**File**: `/Users/mendrika/Projects/mesh/mesh-signals/internal/httpapi/oapigen_adapter.go`
**Duration**: 5 minutes

Add adapter following existing pattern (simple pass-through):
```go
func (s *Server) GetSignalsBestPerformers(w http.ResponseWriter, r *http.Request, _ oapigen.GetSignalsBestPerformersParams) {
    s.getBestPerformersSignals(w, r)
}
```

**Dependencies**: Task 2

---

### Task 4: Regenerate OpenAPI Types
**Command**: `cd /Users/mendrika/Projects/mesh/mesh-signals && make generate-openapi`
**Duration**: 2 minutes

Regenerates Go types from OpenAPI spec.

**Dependencies**: Task 1

---

### Task 5: Build and Test
**Commands**:
```bash
cd /Users/mendrika/Projects/mesh/mesh-signals
go build -o bin/mesh-server ./cmd/mesh-server
curl http://localhost:8080/signals/best_performers?limit=10
```
**Duration**: 5 minutes

Verify endpoint returns proper JSON response.

**Dependencies**: Tasks 1-4

---

## Task Dependency Graph

```
Task 1 (OpenAPI spec)
  ↓
Task 4 (Regenerate types) ←─┐
  ↓                         │
Task 2 (Handler) ───────────┘
  ↓
Task 3 (Adapter)
  ↓
Task 5 (Build & Test)
```

---

## Total Effort Estimate

| Task | Duration | Complexity |
|------|----------|------------|
| Task 1: OpenAPI spec | 10 min | Low |
| Task 2: Handler | 15 min | Low |
| Task 3: Adapter | 5 min | Low |
| Task 4: Regenerate | 2 min | Trivial |
| Task 5: Build & Test | 5 min | Low |
| **Total** | **37 minutes** | **Low** |

---

## Critical Path

The critical path is linear:
1. Add OpenAPI spec
2. Regenerate types
3. Implement handler
4. Implement adapter
5. Test

**Estimated completion time: 40 minutes**

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| OpenAPI codegen errors | Medium | Follow exact schema pattern of existing signals endpoints |
| Type mismatches in handler | Low | Use existing handlers as reference (gems, hot_tokens) |
| Handler calls compute method directly | Low | Pattern confirmed - handlers call Compute* methods on-demand |

---

## Success Criteria

- [ ] OpenAPI spec includes `/signals/best_performers` endpoint
- [ ] Handler returns JSON with rank, agent_id, prediction_count, accuracy
- [ ] Endpoint accepts `limit` query param (1-100, default 10)
- [ ] Response includes `computed_at` timestamp
- [ ] Build completes without errors
- [ ] Manual API test returns 200 OK with valid JSON

---

## Implementation Order

**Phase 1: API Layer (30 min)**
1. Add OpenAPI spec for best_performers endpoint
2. Regenerate OpenAPI types
3. Implement handler function
4. Implement adapter function

**Phase 2: Verification (10 min)**
5. Build server binary
6. Manual endpoint test
7. Update IMPLEMENTATION_VERIFICATION.md

---

## Notes

- Worker already computes and stores best_performers data
- Store method `ComputeBestPerformers()` exists and works
- Just need to expose the data via REST API
- Pattern identical to existing signal endpoints
- No database changes needed
- No migration needed
- No worker changes needed

---

## Completion Checklist

- [ ] Task 1: OpenAPI spec updated
- [ ] Task 2: Handler implemented
- [ ] Task 3: Adapter implemented
- [ ] Task 4: Types regenerated
- [ ] Task 5: Build successful
- [ ] Task 6: Endpoint tested
- [ ] Documentation updated
- [ ] Stage marked complete with [complete]

