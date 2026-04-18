# Resume State — GitHub Integration

**Worktree:** `/Users/mendrika/Projects/Agents/agx/.worktrees/github-integration`
**Branch:** `feat/github-integration` (tracks `origin/feat/github-integration`)
**Spec:** `docs/superpowers/specs/2026-04-17-github-integration-design.md`
**Plan:** `docs/superpowers/plans/2026-04-17-github-integration-phase1.md` (Phase 1)

## Status: Phase 1 + Phase 2a + 2b skeleton + 2c local-side scaffolding — COMPLETE ✅

### Phase 1 — Backend foundations ✅
- Types, SQLite schema, per-project token store
- Repo / PR / comment / link stores
- Tracker-agnostic link resolver (regex + first-match-wins)
- GitHub REST client (fetch injected for tests)
- Sync orchestrator (feature-flagged via `AGX_GITHUB_ENABLED`)
- **28/28 tests green** across 6 github suites
- `tsc --noEmit`: clean (all pre-existing type errors resolved)

### Phase 2a — Tracker resolvers ✅
- `github-resolvers.ts`: Linear resolver (exact identifier match via `listCachedTrackerItems`) + stub agx task resolver
- **agx task resolver is a no-op until a `PREFIX-N identifier` column is added to the `tasks` table** (see "Blockers" below)

### Phase 2b — `/prs` page skeleton ✅
- `GET /api/github/prs` — lists PRs with quick-filter (all / mine / awaiting_review) + repo filter
- `POST /api/github/prs/seed` — dev-only seeder (gated on `NODE_ENV !== "production"`)
- `/projects/[slug]/prs/page.tsx` — two-panel page with seed button, filter tabs, repo dropdown, row list, detail pane
- Sidebar nav entry (GitPullRequest icon) added in `WorkspaceSidebar.tsx`

### Phase 2c — Settings pane + OAuth scaffolding (local side) ✅
- `github-oauth-sessions.ts` — in-memory session store, 10-min TTL
- `GET /api/github/oauth/start` — returns URL to kick off flow at `runagx.com/connect/github`
- `GET /api/github/oauth/return` — receives tokens from `runagx.com`, persists via `saveGithubTokens`, returns self-closing HTML
- `POST /api/github/oauth/disconnect` — clears tokens for a project
- `GET /api/github/oauth/status` — returns connection state (no token material)
- `GET|POST|DELETE /api/github/repos` — attached repo CRUD
- `/projects/[slug]/settings/github/page.tsx` — account status, attached repos list, "Sync now" placeholder

## Files shipped

```
apps/local/lib/
  github-client.ts                 # REST client + refreshGithubTokens
  github-db.ts                     # withGithubDatabase helper + schema
  github-link-resolver.ts          # ID regex + resolvePrLink
  github-oauth-sessions.ts         # in-memory OAuth session store
  github-pr-store.ts               # PR/comment/link CRUD
  github-prs.ts                    # sync orchestrator (feature-flagged)
  github-repo-store.ts             # attached-repos CRUD
  github-resolvers.ts              # Linear + agx resolvers
  github-token-store.ts            # per-project tokens
  github-types.ts                  # shared types

apps/local/app/api/github/
  prs/route.ts
  prs/seed/route.ts
  oauth/start/route.ts
  oauth/return/route.ts
  oauth/disconnect/route.ts
  oauth/status/route.ts
  repos/route.ts

apps/local/app/projects/[slug]/
  prs/page.tsx
  settings/github/page.tsx

apps/local/components/thread/
  WorkspaceSidebar.tsx             # nav entry added

apps/local/__tests__/lib/
  github-client.test.ts
  github-link-resolver.test.ts
  github-pr-store.test.ts
  github-prs.test.ts
  github-repo-store.test.ts
  github-resolvers.test.ts
```

## Blockers to end-to-end

1. **`agx-web` OAuth endpoint**: `https://www.runagx.com/connect/github` and `https://www.runagx.com/api/github/refresh` must exist. Local side assumes the web redirects back with `?session=&access_token=&refresh_token=&expires_at=&login=&scopes=` on the query string to `http://localhost:<port>/api/github/oauth/return`. Cross-repo work.

2. **agx task `PREFIX-N` identifier**: `tasks` table has no stable identifier column. `agxTaskResolver` returns null until a schema migration adds e.g. `identifier TEXT UNIQUE`. Follow-up ticket needed.

3. **GitHub App vs OAuth App choice**: GitHub App requires per-repo install and different OAuth endpoints. OAuth App is simpler. Decide before shipping `agx-web`-side code — see conversation notes.

## Not done in Phase 2

- **Post-push hook**: no trigger for immediate sync on worktree branch push. Sync is pull-on-demand only.
- **CI status / review decision fetching**: `GithubClient.listPullRequests` leaves `ciStatus` and `reviewDecision` as `null`. Needs `GET /repos/.../commits/{sha}/check-runs` and `GET /repos/.../pulls/{n}/reviews`.
- **Inline diff viewer**: deferred by spec; "Open on GitHub" links out.
- **Composer integration on PR detail panel**: placeholder ("Composer coming soon"). Requires reusing the issue-detail chat composer.
- **Unit tests for new API routes and settings/prs pages**: skeleton has no tests; integration tests would need a Next.js test harness.
- **Grouping / pin / label / drag on PR rows**: spec calls for full row-chrome parity with tracker rows; skeleton uses a simple row only.

## How to resume

1. `cd /Users/mendrika/Projects/Agents/agx/.worktrees/github-integration`
2. Read this file + the spec + the plan.
3. To see it locally:
   ```
   cd apps/local
   npm install      # if not done
   npm run dev      # or the repo's usual dev command
   # open http://localhost:<port>/projects/<your-slug>/prs
   # click "Seed demo data" (dev only) to populate rows
   ```
4. Next meaningful slices, each its own worktree:
   - **agx-web OAuth handler** (different repo)
   - **agx task identifier migration** (adds `PREFIX-N` to tasks, unblocks agx resolver)
   - **Post-push sync hook** (wire into worktree push lifecycle)
   - **CI + review fetch** (augment `GithubClient.listPullRequests`)
   - **Row-chrome parity** (reuse `TicketRow` once it's refactored to accept non-tracker items)
   - **Composer on PR detail**

## Commits on branch

```
c2d352b0 fix(github): narrow listGithubPrs params type to satisfy SQLInputValue
d8c609c7 fix(sidebar): drop invalid activeProjectView comparison on PRs nav icon
006eb8fc feat(github): add settings pane for account and attached repos
e66a240b feat(github): add repo management API routes
1d154216 feat(github): add OAuth session store + start/return/status/disconnect endpoints
2b6aa996 feat(github): add tracker resolvers (Linear working, agx task stubbed)
9bb42c5f docs: mark Phase 1 complete in resume state
057fae23 feat(github): add sync orchestrator wiring client + stores + resolver
65d6b700 feat(github): add PR/comment/link store with polymorphic link queries
e952b74a feat(github): add REST client with fetch injection for tests
f69fdefa feat(github): add tracker-agnostic PR link resolver
6f602b11 feat(github): add repo store with CRUD + tests
4ef9161b feat(github): add types, SQLite schema, and per-project token store
7bbbb0a2 docs: add Phase 1 implementation plan for GitHub integration
eb9a7c3f docs: seed GitHub integration spec and resume state
```

## Notes

- Full repo test baseline: 102 pre-existing failures on `origin/main` (unrelated to this branch). Confirmed unchanged by both parallel subagents. Not introduced by this work.
- `tsc --noEmit` on `apps/local` is clean on this branch.
- All GitHub tests: **28/28 passing** across 6 suites.
