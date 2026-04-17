# Resume State — GitHub Integration

**Worktree:** `/Users/mendrika/Projects/Agents/agx/.worktrees/github-integration`
**Branch:** `feat/github-integration` (tracks `origin/main`)
**Spec:** `docs/superpowers/specs/2026-04-17-github-integration-design.md`
**Plan:** `docs/superpowers/plans/2026-04-17-github-integration-phase1.md` (Phase 1 only)

## Scope decision

Only **Phase 1** (schema + stores + OAuth + sync engine, no UI) is being implemented in this session. Phases 2–4 (PRs page, task detail section, settings pane, post-push hook) will get their own worktrees and plans once Phase 1 merges.

## Current status

**Last updated:** (will be updated as work progresses)

- [x] Worktree created
- [x] Resume-state file created
- [ ] Spec copied into worktree
- [ ] Phase 1 plan written
- [ ] Migration file created
- [ ] `github-client.ts` implemented (OAuth proxy)
- [ ] `github-repo-store.ts` implemented
- [ ] `github-pr-store.ts` implemented
- [ ] `github-prs.ts` sync engine implemented
- [ ] Link resolution module implemented
- [ ] Unit tests green
- [ ] `/commit`
- [ ] `/push`

## How to resume

1. `cd /Users/mendrika/Projects/Agents/agx/.worktrees/github-integration`
2. Read this file and the plan.
3. Find the first unchecked task in the plan — start there.
4. Update checkboxes in this file AND in the plan as tasks complete.

## Notes / decisions taken

- Phase 1 targets backend only. No Next.js routes, no React components.
- OAuth client wiring uses `https://www.runagx.com/api/github/*` endpoints; the server-side handler on `agx-web` is out of scope here and will be specified in a follow-up issue.
- For Phase 1 testing, GitHub HTTP calls are mocked — no live API required to run the suite.
- `pr_links` is polymorphic; only `agx_task` and `linear_issue` target types are wired up in Phase 1 (Jira/Intercom are design-ready but deferred).
