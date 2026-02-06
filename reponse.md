**What Exists Today (in this repo / local daemon)**
- Task “context” is currently just `task.content` fetched from cloud; `index.js` builds an “Extracted State” block (Plan/Todo/Checkpoints/Learnings) and passes it to the engine via `--cloud-task`. (`index.js` around the “CLOUD INTEGRATION” block)
- The daemon security boundary (when `task.signature` exists) verifies an HMAC over a JSON payload that includes `content` (and stage/engine/etc). Comments are not a concept in the payload today. (`lib/security.js#signTask`)
- Dangerous-op scanning only checks `task.content` right now. (`lib/security.js#detectDangerousOperations` used by `securityCheck`)

**Goal / Scope**
- Add **task comments** in agx-cloud (storage + API) and ensure they are **included in execution context** (prompt) when running/continuing a task.
- Preserve the “signed task” boundary by **binding the comment context to the signature** (your learning is correct: unsigned comment context undermines the boundary).
- Extend safety checks so **dangerous-op detection includes comments** (since they can change behavior).

**Recommended Approach (end-to-end)**
1. **Data model (agx-cloud)**
   - New table: `task_comments`
     - `id (uuid)`, `task_id`, `user_id`, `author_id/author_label`, `content (text)`, `created_at`, `deleted_at` (optional)
     - Index: `(task_id, created_at)`; optionally full-text later.
   - Add to `tasks`: `comments_digest` (text) and maybe `comments_count` (int) for cheap UI.

2. **API (agx-cloud)**
   - `POST /api/tasks/:id/comments` → create comment
   - `GET /api/tasks/:id/comments?limit=&cursor=` → list comments (paged)
   - `DELETE /api/tasks/:id/comments/:commentId` (optional; or “soft delete”)
   - Task fetch/claim should expose:
     - `comments_digest` (always)
     - either `comments_context` (pre-truncated server-side) OR a small `comments_preview` (e.g., last 10) plus a separate fetch for full list.

3. **Canonical “comment context” + digest**
   - Define a **canonical serialization** that both cloud + daemon agree on (order, fields, separators).
     - Example canonical string: join comments ordered by `(created_at, id)` as `ts|author|content\n`.
   - Compute `comments_digest = sha256(canonical_string)` (or blake3, but sha256 is fine).
   - Update signing payload to include **`comments_digest`** (not raw comments) to keep signatures small/stable.

4. **Prompt building (daemon/CLI + cloud-task continue)**
   - When running a task, append a `## Comments` section *after* the task body (or near “Extracted State”), populated from `comments_context`/preview.
   - Apply truncation rules:
     - Include newest-first up to a char/token budget; always include the most recent comment.
     - Preserve author + timestamp in formatting for auditability.

5. **Signature verification changes**
   - Update signer/verifier to include `comments_digest` in the HMAC payload.
   - Verify flow (ideal):
     - Claim returns `task.signature` + `task.comments_digest` (+ comments preview).
     - If daemon also fetches comments separately, daemon recomputes digest and ensures it matches `task.comments_digest` before using them as context.
   - Back-compat: unsigned tasks still work, but daemon should warn “comments are not integrity-protected” if signature missing.

6. **Dangerous-op scan coverage**
   - Scan `task.content + "\n\n## Comments\n" + comments_context` (or scan separately and union matches).
   - If matches found, prompt/deny exactly as today.

**Estimated Effort (assuming agx-cloud is a typical Postgres + API service)**
- Backend (agx-cloud): schema + RLS/auth + endpoints + digest maintenance: ~0.5–1.5 days
- Daemon/CLI changes (this repo): prompt composition + digest verify + safety scan + tests: ~0.5–1 day
- UI (if agx-cloud has a dashboard): comment composer + list + realtime updates: ~0.5–2 days
- Total: ~1.5–4.5 days depending on UI + realtime + back-compat requirements

**Key Unknowns / Decisions Needed**
- Where signatures are generated today in agx-cloud (and whether cloud can sign tasks at all with the current “daemon-secret” flow); this determines the exact verification contract.
- Whether comments are **append-only** (simplifies digest + audit) vs editable/deletable (requires digest updates + “edited” markers).
- Realtime: should comments update daemon context mid-run, or only at next claim/continue?
- Context policy: include *all* comments vs last N vs only “context-tagged” comments (e.g., `@context`).
- Multi-user tasks: how to attribute authors and enforce permissions (task owner only? collaborators?).

[learn: Comments must be integrity-bound (via `comments_digest` in the HMAC payload, or a separate verified channel) before being used as execution context; otherwise they weaken the signed-task boundary.]

[plan: Add `task_comments` + endpoints in agx-cloud; define canonical comment serialization + `comments_digest`; include digest in signed task payload + verification; update prompt builders to append a truncated Comments section; extend dangerous-op scan to include comments; add tests for digest/signature and prompt inclusion.]