# API: GET /tokens and GET /tokens/{token} - Ideation Phase Plan

**Date:** 2026-02-10
**Status:** Ideation - Analysis & Planning Phase
**Task:** Implement token list and detail endpoints with call statistics

---

## Problem Analysis

### Current State
The AGX Cloud API currently supports:
- User authentication via device flow (`POST /api/auth/device/code`, `POST /api/auth/device/token`)
- Task management with full CRUD operations
- Project and workflow management

**Gap:** There is no way to:
1. List all API tokens issued to a user
2. View details of a specific token
3. See call statistics (usage patterns, rate limiting, audit trail)
4. Manage token lifecycle (issue, revoke, rotate)

### Requirements Context
- **Project:** mesh-signals / AGX Cloud
- **Scope:** Read-only endpoints for token visibility and statistics
- **Users:** Developers and operators managing API access
- **Priority:** Support observability and security auditing

---

## Proposed Solution

### Scope Definition

#### Endpoint 1: GET /api/tokens
**Purpose:** List all tokens for the authenticated user with basic stats

**Query Parameters:**
- `limit` (optional, default=50, max=100): Pagination limit
- `offset` (optional, default=0): Pagination offset
- `sort` (optional): `created_at`, `last_used`, `call_count` (default: `created_at` DESC)
- `include_stats` (optional, default=true): Include call statistics

**Response (200 OK):**
```json
{
  "tokens": [
    {
      "id": "tok_123abc",
      "name": "CLI Token",
      "created_at": "2026-01-15T10:30:00Z",
      "last_used_at": "2026-02-10T14:22:00Z",
      "expires_at": null,
      "is_active": true,
      "stats": {
        "total_calls": 1247,
        "calls_24h": 45,
        "calls_7d": 312,
        "calls_30d": 1200,
        "last_endpoint": "/api/tasks",
        "last_status_code": 200,
        "error_rate_24h": 0.02
      }
    }
  ],
  "total": 5,
  "limit": 50,
  "offset": 0
}
```

**Authorization:** Requires authentication (Bearer token or session)

#### Endpoint 2: GET /api/tokens/{token}
**Purpose:** Get detailed information about a specific token

**Path Parameters:**
- `token` (required): Token ID or partial token string

**Query Parameters:**
- `include_audit` (optional, default=false): Include audit log of API calls
- `include_rate_history` (optional, default=false): Include rate limiting history
- `audit_limit` (optional, default=100): Maximum audit entries to return

**Response (200 OK):**
```json
{
  "token": {
    "id": "tok_123abc",
    "name": "CLI Token",
    "prefix": "agx_",
    "created_at": "2026-01-15T10:30:00Z",
    "last_used_at": "2026-02-10T14:22:00Z",
    "expires_at": null,
    "is_active": true,
    "created_by_ip": "192.168.1.100",
    "last_used_ip": "203.0.113.45",
    "scopes": ["tasks:read", "projects:read", "workflows:read"],
    "stats": {
      "total_calls": 1247,
      "calls_24h": 45,
      "calls_7d": 312,
      "calls_30d": 1200,
      "success_rate": 0.98,
      "error_rate_24h": 0.02,
      "avg_response_time_ms": 245,
      "endpoints": {
        "/api/tasks": 612,
        "/api/projects": 445,
        "/api/workflows": 190
      }
    }
  },
  "audit_log": [
    {
      "timestamp": "2026-02-10T14:22:00Z",
      "method": "GET",
      "endpoint": "/api/tasks",
      "status_code": 200,
      "response_time_ms": 142,
      "ip_address": "203.0.113.45",
      "user_agent": "agx-cli/1.4.26"
    }
  ]
}
```

**Authorization:** Requires authentication + token ownership or admin role

---

## Implementation Approach

### Phase 1: Database Schema

#### New Tables

**`agx.api_tokens`** - Store issued tokens
```sql
CREATE TABLE agx.api_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    name text NOT NULL,
    prefix text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    scopes text[] DEFAULT ARRAY['tasks:read', 'projects:read'],
    is_active boolean DEFAULT true,
    expires_at timestamptz NULLABLE,
    created_at timestamptz DEFAULT now(),
    last_used_at timestamptz NULLABLE,
    created_by_ip inet,
    last_used_ip inet,
    revoked_at timestamptz NULLABLE,
    revoked_reason text,
    version integer DEFAULT 1,
    UNIQUE(user_id, name),
    CHECK (created_at <= now())
);
```

**`agx.token_call_stats`** - Aggregate statistics (for performance)
```sql
CREATE TABLE agx.token_call_stats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id uuid NOT NULL REFERENCES agx.api_tokens(id) ON DELETE CASCADE,
    date date NOT NULL,
    total_calls integer DEFAULT 0,
    success_calls integer DEFAULT 0,
    error_calls integer DEFAULT 0,
    avg_response_time_ms integer,
    max_response_time_ms integer,
    rate_limited_count integer DEFAULT 0,
    last_endpoint text,
    last_status_code integer,
    updated_at timestamptz DEFAULT now(),
    PRIMARY KEY (token_id, date),
    CONSTRAINT positive_calls CHECK (total_calls >= 0)
);
```

**`agx.token_audit_log`** - Detailed call audit trail
```sql
CREATE TABLE agx.token_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id uuid NOT NULL REFERENCES agx.api_tokens(id) ON DELETE CASCADE,
    timestamp timestamptz DEFAULT now(),
    method text NOT NULL,
    endpoint text NOT NULL,
    status_code integer NOT NULL,
    response_time_ms integer,
    ip_address inet,
    user_agent text,
    error_message text NULLABLE,
    request_size_bytes integer,
    response_size_bytes integer,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_token_audit_log_token_timestamp
    ON agx.token_audit_log(token_id, timestamp DESC);
CREATE INDEX idx_token_audit_log_created_at
    ON agx.token_audit_log(created_at DESC);
```

### Phase 2: API Endpoints

**File Structure:**
```
/Users/mendrika/Projects/Agents/agx-cloud/app/api/
├── tokens/
│   ├── route.ts          # GET /api/tokens (list)
│   └── [token]/
│       └── route.ts      # GET /api/tokens/{token} (detail)
```

**Key Implementation Details:**
1. **Authentication:** Use existing `LOCAL_USER` pattern or session middleware
2. **Authorization:**
   - Users can only see their own tokens
   - Admin users can see all tokens (if role-based access exists)
3. **Response Format:** Consistent with existing API patterns (tasks, projects, workflows)
4. **Error Handling:**
   - 400: Invalid parameters
   - 401: Not authenticated
   - 403: No permission to view token
   - 404: Token not found
   - 500: Server error

### Phase 3: Middleware/Hooks

**Token Interceptor Middleware:**
- Add hook to existing middleware chain
- Log every API request to `agx.token_audit_log`
- Capture: timestamp, endpoint, status, IP, user agent, response time
- Update `token_call_stats` on daily rollup (could be cron job or on-write)
- Update `last_used_at` timestamp on first call per token per day

### Phase 4: Query Optimization

**Indexes:**
```sql
CREATE INDEX idx_api_tokens_user_id_created_at
    ON agx.api_tokens(user_id, created_at DESC);
CREATE INDEX idx_api_tokens_user_id_is_active
    ON agx.api_tokens(user_id, is_active);
CREATE INDEX idx_token_call_stats_token_id_date
    ON agx.token_call_stats(token_id, date DESC);
```

---

## Effort Estimation

| Task | Hours | Notes |
|------|-------|-------|
| Database schema design + SQL migration | 1.5 | Define tables, constraints, indexes |
| Data migration script (if needed) | 0.5 | For existing users/tokens |
| GET /api/tokens endpoint | 2 | List, filtering, pagination, stats aggregation |
| GET /api/tokens/{token} endpoint | 2 | Detail view, audit log retrieval, authorization |
| Middleware for token request logging | 1.5 | Intercept, log, update stats |
| Stats aggregation (cron/batch) | 1 | Daily rollup from audit log to stats table |
| Tests (unit + integration) | 2 | Happy path + error cases |
| Documentation & API docs | 0.5 | OpenAPI/Swagger updates |
| **Total** | **10.5** | Estimated effort in hours |

---

## Key Unknowns & Open Questions

### Database & Schema
1. **Users Table:** Does `agx.users` table exist? What is the primary key structure?
   - *Question:* Should we reuse existing user_id UUID references?
2. **Token Hashing:** What hashing algorithm is preferred? (bcrypt, argon2, scrypt)
   - *Current assumption:* bcrypt-like approach with cost factor
3. **Token Expiration:** Should tokens have TTL? Max age enforced?
   - *Current assumption:* Optional `expires_at`, configurable per token
4. **Rate Limiting State:** Should rate limiting be enforced per-token or per-user?
   - *Current assumption:* Per-token tracking, user-level enforcement depends on existing system

### Permissions & Authorization
5. **Token Scopes:** What granularity of scopes is needed?
   - *Current assumption:* Simple scopes like `tasks:read`, `projects:read`
   - *Question:* Do we need resource-level scopes (e.g., `tasks:read:project:123`)?
6. **Admin Access:** Do operators/admins need to view all user tokens?
   - *Current assumption:* Tokens are user-private by default
7. **Token Rotation:** Should users be able to rotate/regenerate tokens?
   - *Out of scope for this phase* (read-only endpoints only)

### Performance & Data Retention
8. **Audit Log Retention:** How long to keep detailed audit entries?
   - *Current assumption:* 90 days (configurable)
9. **Stats Aggregation:** Real-time stats vs. periodic batch jobs?
   - *Current assumption:* Daily rollup batch + cached last 24h metrics
10. **Monitoring:** Integration with existing monitoring/observability?
    - *Question:* Should stats feed into Prometheus, Datadog, etc.?

### API Design
11. **Response Size:** Should audit log pagination be mandatory for large token histories?
    - *Current assumption:* Yes, `audit_limit=100` by default
12. **Stats Granularity:** Endpoint-level vs. broader categorization?
    - *Current assumption:* Top endpoints by call count, aggregated error rates
13. **Token Display:** Should we return full token in responses? (security risk?)
    - *Current assumption:* No. Only show prefix + last 4 chars (`agx_****23ab`)

### Future Capabilities (Out of Scope)
- Token revocation endpoint (DELETE)
- Token rotation endpoint (POST to regenerate)
- Token creation endpoint (POST)
- Webhook notifications on suspicious activity
- Rate limit configuration per token
- Granular scope management

---

## Assumptions

1. **Existing authentication/authorization** is in place and can be reused
2. **`agx.users` table exists** or can be created as a prerequisite
3. **SQL migrations** can be applied independently without breaking existing schema
4. **Middleware hooks** exist or can be added to request processing pipeline
5. **PostgreSQL** with jsonb and inet data types is available
6. **Bearer token validation** follows standard OAuth 2.0 pattern
7. **Stats aggregation** is acceptable to run asynchronously (not real-time)

---

## Success Criteria

The ideation phase is complete when:

- [x] **Scope Defined:** Clear boundaries on what endpoints do and don't do
- [x] **Database Schema Analyzed:** Tables, columns, constraints documented
- [x] **API Design Specified:** Request/response formats, HTTP status codes
- [x] **Authorization Model:** Clear rules on who can see what
- [x] **Effort Estimated:** Realistic hours breakdown by task
- [x] **Unknowns Documented:** Open questions ready for design review
- [x] **Assumptions Stated:** Context dependencies called out
- [x] **No Implementation Started:** Planning only, no code changes

---

## Next Phase: Planning

Once this ideation is approved:

1. **Design Review:** Validate assumptions with team
2. **Database Migration:** Write SQL scripts for schema changes
3. **API Implementation:** Build endpoints and middleware
4. **Testing:** Unit + integration + performance testing
5. **Documentation:** OpenAPI spec, API docs, examples
6. **Deployment:** Migration + rollout strategy
