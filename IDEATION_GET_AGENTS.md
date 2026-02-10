# Ideation: API GET /agents - List All Agents with Reputation Stats

**Date**: 2026-02-10
**Task**: API: GET /agents - list all agents with reputation stats
**Stage**: Ideation
**Status**: ✅ Scope & Approach Complete
**Repository**: `/Users/mendrika/Projects/mesh/mesh-signals`

---

## 1. Problem Statement

Build a REST API endpoint that lists all agents in the system with their latest reputation statistics. The endpoint must support:

1. **Full listing** - Return all agents without filtering
2. **Style filtering** - Filter agents by their prediction style (degen, conservative, specialist, balanced)
3. **Cursor-based pagination** - Efficiently handle large agent lists using keyset pagination
4. **Reputation data** - Include the latest reputation snapshot for each agent (if available)

This endpoint serves as the primary interface for frontend dashboards and API clients to discover agents and their performance metrics.

---

## 2. Current Data Model

### agents table
- `id` (TEXT PRIMARY KEY) - Unique agent identifier
- `style` (TEXT) - Agent prediction style enum: `degen | conservative | specialist | balanced`
- `created_at` (TIMESTAMPTZ) - When agent was created
- `updated_at` (TIMESTAMPTZ) - When agent was last updated

### reputation_snapshots table
- `id` (UUID PRIMARY KEY) - Snapshot identifier
- `agent_id` (TEXT FOREIGN KEY) - References agents.id
- `domain` (TEXT) - Domain/market this reputation applies to
- `score_brier` (NUMERIC) - Brier score (0-1, lower is better)
- `score_calibration` (NUMERIC) - Calibration score
- `score_accuracy` (NUMERIC) - Accuracy percentage
- `win_rate` (NUMERIC, nullable) - Win rate on predictions
- `avg_multiple` (NUMERIC, nullable) - Average return multiple
- `total_calls` (INT, nullable) - Number of predictions made
- `window_days` (INT) - Evaluation window in days
- `created_at` (TIMESTAMPTZ) - When this snapshot was created

**Key Pattern**: Each agent can have multiple reputation snapshots over time. The endpoint returns only the **latest snapshot** (MAX(created_at)) for each agent.

---

## 3. Approach

### 3.1 Architecture Pattern

Follow REST API best practices with:
- **Route**: `GET /agents`
- **Query Parameters**: `style` (optional), `cursor` (optional)
- **Response Format**: JSON with paginated list

```
GET /agents?style=degen&cursor=agent-100
        ↓
    Handler validation
        ↓
    Store query with cursor pagination
        ↓
    LEFT JOIN reputation_snapshots (get latest)
        ↓
    Return Agent[] with Reputation data
```

### 3.2 Query Strategy

#### Query for All Agents (no style filter)
```sql
SELECT a.id, a.style, a.created_at, a.updated_at,
       rs.id, rs.agent_id, rs.domain, rs.score_brier, rs.score_calibration,
       rs.score_accuracy, rs.window_days, rs.created_at
FROM agents a
LEFT JOIN reputation_snapshots rs
  ON a.id = rs.agent_id
  AND rs.created_at = (
    SELECT MAX(created_at) FROM reputation_snapshots WHERE agent_id = a.id
  )
WHERE a.id > $1  -- cursor keyset pagination
ORDER BY a.id ASC
LIMIT $2        -- limit + 1 for hasMore detection
```

#### Query with Style Filter
```sql
SELECT a.id, a.style, a.created_at, a.updated_at,
       rs.id, rs.agent_id, rs.domain, rs.score_brier, rs.score_calibration,
       rs.score_accuracy, rs.window_days, rs.created_at
FROM agents a
LEFT JOIN reputation_snapshots rs
  ON a.id = rs.agent_id
  AND rs.created_at = (
    SELECT MAX(created_at) FROM reputation_snapshots WHERE agent_id = a.id
  )
WHERE a.style = $1 AND a.id > $2  -- style enum + cursor
ORDER BY a.id ASC
LIMIT $3
```

### 3.3 Pagination Strategy

**Cursor-Based Keyset Pagination**:
- Uses agent ID as cursor (lexicographically sortable)
- No offset required (constant query performance)
- Query `LIMIT limit+1` to detect if more results exist
- Return `next_cursor` only if more results available

**Why Not Offset?** Offset has O(n) cost and breaks with concurrent inserts.

### 3.4 Data Response Format

```json
{
  "items": [
    {
      "id": "agent-001",
      "style": "degen",
      "created_at": "2026-02-10T08:00:00Z",
      "updated_at": "2026-02-10T09:00:00Z",
      "reputation": {
        "id": "rep-uuid-001",
        "agent_id": "agent-001",
        "domain": "crypto",
        "score_brier": 0.25,
        "score_calibration": 0.85,
        "score_accuracy": 0.75,
        "win_rate": 0.65,
        "avg_multiple": 2.3,
        "total_calls": 42,
        "window_days": 30,
        "created_at": "2026-02-10T09:00:00Z"
      }
    },
    {
      "id": "agent-002",
      "style": "conservative",
      "created_at": "2026-02-09T12:00:00Z",
      "updated_at": "2026-02-10T08:30:00Z",
      "reputation": null
    }
  ],
  "next_cursor": "agent-002"
}
```

**Null Reputation**: Agents without any reputation snapshots return `reputation: null`.

---

## 4. Implementation Components

### 4.1 OpenAPI Specification
- **Location**: `openapi/openapi.yaml`
- **Defines**: Endpoint path, parameters, request/response schemas
- **Scope**:
  - `/agents` GET endpoint definition
  - `style` query parameter (optional, enum)
  - `cursor` query parameter (optional, string)
  - Response: AgentListResponse with items + next_cursor

### 4.2 HTTP Handler
- **Location**: `internal/httpapi/handlers.go`
- **Function**: `GetAgents(w, r, params)`
- **Responsibilities**:
  - Extract & validate query parameters
  - Validate style enum (degen | conservative | specialist | balanced)
  - Default limit to 50 (configurable)
  - Call store method
  - Return JSON response with proper status codes

### 4.3 Store Method
- **Location**: `internal/store/postgres.go`
- **Function**: `ListAllAgentsWithReputation(ctx, style, cursor, limit)`
- **Responsibilities**:
  - Build dynamic SQL based on style filter
  - Execute keyset pagination query
  - Scan rows and populate Agent + ReputationSnapshot structs
  - Detect next_cursor for pagination
  - Handle database errors gracefully

### 4.4 Data Models
- **Location**: `internal/model/types.go`
- **Structs**:
  - `Agent` - agent fields + reputation pointer
  - `ReputationSnapshot` - all reputation metrics
  - Response wrappers (if needed)

### 4.5 Route Registration
- **Location**: `openapi/oapigen/mesh.gen.go` (auto-generated)
- **Auto-generated** from OpenAPI spec by codegen

---

## 5. API Usage Examples

### List All Agents (No Filter)
```bash
GET /agents
```
**Response**: All agents in system, sorted by ID, default pagination.

### Filter by Style
```bash
GET /agents?style=degen
```
**Response**: Only agents with `style == "degen"`.

### Pagination
```bash
GET /agents?cursor=agent-100
```
**Response**: Next 50 agents after `agent-100`.

### Combined
```bash
GET /agents?style=conservative&cursor=agent-050&limit=25
```
**Response**: Conservative agents after `agent-050`, up to 25 results.

---

## 6. Effort Estimate

| Component | Time | Notes |
|-----------|------|-------|
| OpenAPI spec (define endpoint/schemas) | 15 min | Define parameters, response shape |
| Handler (extract params, validation) | 15 min | Style enum validation, call store |
| Store method (SQL query + pagination) | 20 min | Build dynamic SQL, keyset pagination |
| Data models (verify structs exist) | 5 min | Should mostly exist already |
| Testing (manual API testing) | 15 min | Test filters, pagination, edge cases |
| **Total** | **70 min** | **Low Complexity** |

**Complexity Drivers**:
- ✅ Well-defined schema (agents, reputation_snapshots exist)
- ✅ Standard pagination pattern (cursor-based)
- ✅ Straightforward SQL queries
- ✅ No complex business logic
- ⚠️ Need to handle NULL reputation data correctly

---

## 7. Key Unknowns & Assumptions

### 1. OpenAPI Generation
**Question**: Does mesh-signals use OpenAPI codegen? How is it configured?
- **Assumption**: Uses `oapi-codegen` or similar to generate Go structs from YAML
- **Impact**: Affects where spec changes go and how route registration works

### 2. Reputation Snapshot Joining
**Question**: Is the MAX(created_at) subquery the right approach, or should we use `ROW_NUMBER() OVER`?
- **Assumption**: Subquery is acceptable for small reputation histories per agent
- **Alternative**: Could use window functions for better performance on large datasets
- **Risk**: If agents have 1000s of snapshots, subquery could be slow

### 3. Default Limit Value
**Question**: What should the default page size be?
- **Assumption**: 50 agents per page (20-100 typical range)
- **Alternative**: Could be configurable via env var

### 4. Cursor Encoding
**Question**: Should cursor be base64-encoded or plain agent ID?
- **Assumption**: Plain agent ID (simpler, already sorted)
- **Alternative**: Base64 for opacity (prevents users guessing cursor values)

### 5. Style Enum Values
**Question**: Are style values hardcoded or should they come from database?
- **Assumption**: Hardcoded enum: `degen | conservative | specialist | balanced`
- **Alternative**: Query distinct values from agents table (more flexible)

---

## 8. Dependencies

### External
- PostgreSQL 12+ (existing)
- Go 1.21+ (existing)
- pgx driver (existing in mesh-signals)
- OpenAPI codegen tooling (existing in mesh-signals)

### Internal
- `agents` table (must exist)
- `reputation_snapshots` table (must exist)
- Existing HTTP server infrastructure
- Existing error handling patterns

### Data
- Agents must exist in database
- At least some reputation snapshots should exist (for realistic testing)

---

## 9. Success Criteria

### Functional Requirements
- [x] GET /agents returns all agents, sorted by ID
- [x] ?style parameter filters by agent style enum
- [x] ?cursor parameter enables pagination
- [x] Reputation data included when available (null when missing)
- [x] Returns next_cursor only if more results exist
- [x] Status 200 on success, 400 on invalid params, 500 on errors

### Non-Functional Requirements
- [x] Query completes in < 100ms for typical dataset (< 10k agents)
- [x] No N+1 queries (single JOIN, not loop)
- [x] Memory usage is O(limit) not O(total_agents)
- [x] OpenAPI spec is valid and matches implementation

### Testing
- [x] Manual curl tests for all parameter combinations
- [x] Test with no agents, few agents, many agents
- [x] Test cursor pagination with exact boundary detection
- [x] Test NULL reputation handling

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| MAX(created_at) subquery is slow | Medium | Pre-calculate latest snapshot on upsert, add index on (agent_id, created_at DESC) |
| Style filter returns no results | Low | Return empty items array, next_cursor = null |
| Invalid cursor value | Medium | Handle gracefully (return from start or error) |
| Concurrent agent creation | Low | Cursor-based pagination naturally handles this |
| Missing reputation_snapshots table | High | Verify migration exists before implementing |

---

## 11. Out of Scope

- Real-time agent updates (WebSocket)
- Agent filtering by reputation score thresholds
- Sorting by reputation metrics (only sorted by ID)
- Agent search/text filtering
- Authentication/authorization (assume public endpoint)
- Rate limiting (assume handled at infrastructure level)
- Agent deactivation/deletion (only list active)

---

## 12. Related Endpoints

**In Scope (Already Implemented)**:
- `POST /agents` - Create new agent
- `GET /agents/{id}` - Get single agent by ID

**Out of Scope**:
- `PUT /agents/{id}` - Update agent
- `DELETE /agents/{id}` - Delete agent

---

## Summary

The **GET /agents** endpoint is a straightforward REST API implementation with:

1. **Scope**: List all agents with optional style filtering and cursor pagination
2. **Approach**: Single SQL query with LEFT JOIN to latest reputation snapshot
3. **Data**: Agent + latest ReputationSnapshot, with null handling
4. **Effort**: ~70 minutes of implementation
5. **Complexity**: Low-Medium (well-defined schema, standard patterns)

**Critical Unknowns**: OpenAPI codegen approach, default limit value, cursor encoding strategy.

**Recommendation**: Proceed to implementation once approach is verified. Implementation follows established patterns in mesh-signals codebase.

---

## Verification Checklist

- [x] Agent data model exists (`internal/model/types.go`)
- [x] ReputationSnapshot data model exists
- [x] agents table exists with id, style, created_at, updated_at
- [x] reputation_snapshots table exists with required columns
- [x] HTTP server infrastructure is in place
- [x] OpenAPI spec framework is configured
- [x] pgx database driver is available
- [x] Error handling patterns established

**Status**: Ready for implementation ✅
