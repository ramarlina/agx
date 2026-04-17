# Resume State — GitHub Integration

**Worktree:** `/Users/mendrika/Projects/Agents/agx/.worktrees/github-integration`
**Branch:** `feat/github-integration` (tracks `origin/main`)
**Spec:** `docs/superpowers/specs/2026-04-17-github-integration-design.md`
**Plan:** `docs/superpowers/plans/2026-04-17-github-integration-phase1.md` (Phase 1 only)

## Scope decision

Only **Phase 1** (schema + stores + OAuth + sync engine, no UI) was implemented in this session. Phases 2–4 (PRs page, task detail section, settings pane, post-push hook, OAuth browser flow on desktop) are deferred to their own worktrees + plans.

## Status: Phase 1 COMPLETE ✅

- [x] Worktree created
- [x] Resume-state file created
- [x] Spec copied into worktree
- [x] Phase 1 plan written
- [x] Types module (`github-types.ts`)
- [x] DB helper + schema (`github-db.ts`) — 4 tables + sync_state
- [x] Token store (`github-token-store.ts`) — per-project `~/.agx/projects/{id}/integrations/github.json`
- [x] Repo store (`github-repo-store.ts`) — 5/5 tests pass
- [x] PR/comment/link store (`github-pr-store.ts`) — 7/7 tests pass, polymorphic `pr_links` verified
- [x] Link resolver (`github-link-resolver.ts`) — 5/5 tests pass (regex, first-match-wins)
- [x] GitHub REST client (`github-client.ts`) — 3/3 tests pass, fetch injectable
- [x] Sync orchestrator (`github-prs.ts`) — 3/3 tests pass, feature-flagged via `AGX_GITHUB_ENABLED`
- [x] Full test suite: **23/23 passing** across 5 suites
- [x] `/commit` (done per task)
- [ ] `/push` (pending)

## Files delivered

```
apps/local/lib/
  github-client.ts          # REST client + GithubAuthError + refreshGithubTokens
  github-db.ts              # withGithubDatabase helper + schema
  github-link-resolver.ts   # ID regex + resolvePrLink (tracker-agnostic)
  github-pr-store.ts        # PR/comment/link CRUD
  github-prs.ts             # sync orchestrator (feature-flagged)
  github-repo-store.ts      # attached-repos CRUD
  github-token-store.ts     # per-project tokens
  github-types.ts           # shared types

apps/local/__tests__/lib/
  github-client.test.ts
  github-link-resolver.test.ts
  github-pr-store.test.ts
  github-prs.test.ts
  github-repo-store.test.ts
```

## How to resume (for Phase 2+)

1. `cd /Users/mendrika/Projects/Agents/agx/.worktrees/github-integration` (or a new worktree branched off `main` after this PR merges).
2. Read the spec and this file.
3. Next likely slices (each its own worktree + plan):
   - **2a. OAuth UX**: browser flow kicked off from agx settings → runagx.com → callback → token store. Requires `agx-web` side work too (out of this repo).
   - **2b. Tracker resolvers**: implement `TrackerResolver` instances that query the agx `tasks` table and the `linear_issues` store. Wire them into `syncRepo` at the orchestration layer (likely in a server action / cron handler).
   - **2c. PRs page**: `/prs` route, two-panel UI, reusing the existing issue row component. Enable `AGX_GITHUB_ENABLED=1` only when the UI lands.
   - **2d. Task detail section**: "Linked PRs" block on task and tracker-issue detail views. Uses `listPrLinksForTarget`.
   - **2e. Post-push hook**: trigger sync on branch push from a worktree.

## Notes / decisions taken

- Phase 1 targets backend only. No Next.js routes, no React components.
- Credentials path: `~/.agx/projects/{projectId}/integrations/github.json` (matches Linear convention — per-project, not global — even though the spec originally suggested `~/.agx/github/credentials.json`). Revisit if you want a global default.
- Regex is **case-sensitive** (no `/i` flag). `abc-123` does not match, `AGX-42` does. This matches the test contract in the plan; the spec's flag annotation was advisory.
- The `GithubClient` takes an injectable `fetchImpl` so tests run offline. Production callers use the default (`fetch`).
- `refreshGithubTokens()` is wired to proxy through `https://www.runagx.com/api/github/refresh` — the server-side handler on `agx-web` is out of scope here and must be shipped before OAuth works end-to-end.
- Ships feature-flagged: `AGX_GITHUB_ENABLED !== "1"` ⇒ `syncRepo` is a no-op. Keeps Phase 1 dormant until UI lands.
- DB at `~/.agx/github/prs.sqlite` (override with `AGX_GITHUB_DIR`).

## Commits on branch

- `eb9a7c3f` docs: seed GitHub integration spec and resume state
- `7bbbb0a2` docs: add Phase 1 implementation plan for GitHub integration
- `4ef9161b` feat(github): add types, SQLite schema, and per-project token store
- `6f602b11` feat(github): add repo store with CRUD + tests
- `f69fdefa` feat(github): add tracker-agnostic PR link resolver
- `65d6b700` feat(github): add PR/comment/link store with polymorphic link queries
- `e952b74a` feat(github): add REST client with fetch injection for tests
- `057fae23` feat(github): add sync orchestrator wiring client + stores + resolver
