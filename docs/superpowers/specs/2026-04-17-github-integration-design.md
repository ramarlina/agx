# GitHub Integration — Design

**Date:** 2026-04-17
**Status:** Draft for review
**Scope:** Link GitHub pull requests to agx tasks and tracker issues (Linear, Jira, future), and add a dedicated PRs page with a two-panel review UI that mirrors the existing issue view.

---

## 1. Goals

1. On every task / tracker-issue row, surface how many PRs are linked and the overall state of those PRs, using the existing row chrome (no bespoke widgets).
2. Provide a dedicated **PRs page** — two-panel list + detail — where the detail panel uses the same recap + sessions + composer structure as the existing issue detail view.
3. Make PR linkage **tracker-agnostic** from day one: the same mechanism links PRs to agx tasks today and to Linear / Jira / Intercom / future trackers tomorrow.

## 2. Non-goals (v1)

- Inline diff viewer. v1 links out to GitHub for the diff.
- Webhook-driven real-time updates. v1 is polling + post-push triggers (agx is local-first; no public endpoint).
- Cross-tracker linking (Linear ↔ Jira). Only PR ↔ tracker-item is in scope.
- A unified PRs + issues inbox. PRs get their own top-level surface.

## 3. Architecture

A new **GitHub adapter module** under `apps/local/lib/`, mirroring the Linear adapter pattern:

```
github-client.ts       # OAuth, token refresh, GraphQL/REST calls
github-repo-store.ts   # attached repos (SQLite)
github-pr-store.ts     # PR + comment cache + pr_links (SQLite)
github-prs.ts          # sync orchestration, polling, link resolution
```

Repos are the GitHub equivalent of Linear teams — the user adds `owner/repo` entries that scope all sync.

### 3.1 OAuth (proxied through `runagx.com`)

The GitHub OAuth App is registered to `https://www.runagx.com` with callback `https://www.runagx.com/api/github/callback`. `client_id` and `client_secret` live in the `agx-web` repo and never ship with the local agx binary.

Flow:

1. Local agx spins up a one-shot loopback on `http://localhost:<port>` and opens `https://www.runagx.com/connect/github?session=<id>&port=<port>` in the browser.
2. `agx-web` redirects to GitHub's OAuth authorize URL.
3. User approves on GitHub → GitHub calls `https://www.runagx.com/api/github/callback?code=…&state=…`.
4. `agx-web` exchanges the code for `access_token` + `refresh_token` using `client_secret`, then redirects the browser to `http://localhost:<port>/github-callback?token=…&refresh=…&expires_at=…`.
5. Local agx captures the tokens and writes them to `~/.agx/github/credentials.json`. The loopback shuts down.
6. Refresh flow proxies through `agx-web` (`POST https://www.runagx.com/api/github/refresh`) so `client_secret` stays server-side.

Requested scopes: `repo` (PRs + comments on public and private repos), `read:org` (for repo picker).

### 3.2 Sync strategy

- On app start: refresh tokens if expired; run one sync per attached repo.
- Foreground poll: 60s (configurable).
- Idle poll: 5min.
- Post-push hook: when an agent pushes a branch from a worktree, enqueue an immediate sync for the repo that owns that worktree.
- Per-repo sync: fetch PRs updated since `last_synced_at` (GitHub `since` query), plus reviewers, check runs, labels. Upsert into `github_prs`. Re-run link resolution on changed rows.
- Comments are **lazy**: only fetched for the PR currently open in the right panel, and on "Regenerate recap".

## 4. Data model

New tables in the agx SQLite DB.

```sql
CREATE TABLE github_repos (
  id TEXT PRIMARY KEY,               -- "owner/repo"
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  default_branch TEXT,
  private INTEGER,
  access_revoked INTEGER DEFAULT 0,
  added_at INTEGER,
  last_synced_at INTEGER
);

CREATE TABLE github_prs (
  id TEXT PRIMARY KEY,               -- "owner/repo#number"
  repo_id TEXT NOT NULL REFERENCES github_repos(id),
  number INTEGER NOT NULL,
  title TEXT,
  body TEXT,
  state TEXT,                        -- open | closed | merged
  draft INTEGER,
  author_login TEXT,
  head_ref TEXT,
  head_sha TEXT,
  base_ref TEXT,
  url TEXT,
  ci_status TEXT,                    -- success | failure | pending | null
  review_decision TEXT,              -- approved | changes_requested | review_required | null
  assignees_json TEXT,
  reviewers_json TEXT,
  labels_json TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  merged_at INTEGER,
  closed_at INTEGER,
  last_synced_at INTEGER
);

CREATE TABLE pr_links (
  pr_id TEXT NOT NULL REFERENCES github_prs(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,         -- 'agx_task' | 'linear_issue' | 'jira_issue' | …
  target_id TEXT NOT NULL,
  link_source TEXT NOT NULL,         -- 'branch' | 'title' | 'body' | 'manual'
  created_at INTEGER,
  PRIMARY KEY (pr_id, target_type, target_id)
);
CREATE INDEX idx_pr_links_target ON pr_links(target_type, target_id);

CREATE TABLE github_pr_comments (
  id TEXT PRIMARY KEY,               -- GitHub comment ID
  pr_id TEXT NOT NULL REFERENCES github_prs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                -- 'issue_comment' | 'review' | 'review_comment'
  author_login TEXT,
  body TEXT,
  path TEXT,                         -- review_comment file path
  line INTEGER,                      -- review_comment line
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX idx_github_pr_comments_pr ON github_pr_comments(pr_id);
```

The polymorphic `pr_links` table is the single place where PR ↔ tracker-item associations live. `target_type` identifies the tracker; `target_id` is whatever identifier that tracker uses (agx task UUID, Linear `AGX-45`, Jira `PROJ-123`, …).

## 5. Link resolution

A single pattern extracts tracker IDs from a PR:

```
ID_PATTERN = /(?<![A-Za-z0-9])[A-Z]+-\d+(?![A-Za-z0-9])/i
```

For each PR, walk the following fields in order:

1. `head_ref` (branch name)
2. `title`
3. `body`

Extract all regex matches per field, preserving first-seen order. For each extracted ID, look it up across registered tracker stores (agx tasks, Linear issues, Jira issues). **On the first ID that resolves to a tracker item, create `pr_links(pr_id, target_type, target_id, link_source)` and stop** — one auto-resolved link per PR.

`link_source` records which field yielded the match (`branch` | `title` | `body`). Manual links are recorded with `link_source='manual'` and are additive — they are never overwritten or removed by auto-resolution.

Resolution runs on PR create and on PR update when any of `head_ref`, `title`, `body` changed.

**Prerequisite:** agx tasks must expose a stable `PREFIX-N` identifier (matching how Linear and Jira already work). If the current schema doesn't produce one, the implementation plan will add it.

## 6. UI

### 6.1 PRs page (new top-level route `/prs`)

Two-panel layout. Left panel is a PR list that reuses the **same row component, chrome, and behaviors** as the existing task/issue row:

- ID pill (`AGX#201`), truncated title, hover-revealed action cluster (label, note, pin, copy URL, open externally, more), selection checkbox, drag-reorder, grouping, sort, search.
- PR-specific trailing metadata on each row: state glyph, CI status, review decision, author, updated-at.
- Quick-filter tabs at the top of the list: **All** · **My PRs** (authored or assigned) · **Awaiting my review** (review_requested).
- Repo filter (multi-select dropdown over attached repos).
- Group-by options: Status, Repo, Author, Review decision, Linked ticket.

Internally, the row component is parameterized by item type so that PRs and tickets satisfy the same interface.

### 6.2 PR detail (right panel)

Matches the existing issue detail layout:

- **Header:** `OWNER/REPO#N` · title · state dropdown · `[📄 Session script]` · `[▷ Start scripted session]`
- **Recap:** auto-generated summary (title, CI status, open review comments, conflicts) with `Updated Xm ago` and `[↻ Regenerate]`. Recap regeneration fetches the latest comments.
- **What's open:** bullet list of open review threads / pending reviewers.
- **Linked:** list of linked tracker items (`AGX-45 — …`) clickable to navigate.
- **GitHub metadata:** branch arrow (`head → base`), CI, reviewer states, labels, "Open on GitHub ↗".
- **Session history:** list of agx scripted/manual sessions scoped to this PR, identical to the issue session list.
- **Composer:** same composer as issue detail (attachments, agents dropdown, pinned agent, Send, Enter/Shift+Enter hint).

PRs own their own session scope — agents working on a PR (e.g. "address review comments") record sessions on that PR, not on the linked task.

### 6.3 Task/issue detail — linked PRs

On existing task and tracker-issue detail views, a compact "Pull Requests (N)" section lists linked PRs as minimal rows (title, state, CI, review decision). Clicking a row deep-links into the PRs page with that PR open. `+ Link PR` action accepts a pasted PR URL and writes `pr_links(..., 'manual')`.

### 6.4 Task row indicators

Linked PR state surfaces on task rows **through the existing row vocabulary** (label chip or note glyph populated by the link), not a bespoke badge.

### 6.5 Settings — GitHub

A new settings pane with:

- Account status (connected login, scopes, expiry) + Connect/Disconnect.
- Attached repositories list with add/remove and per-repo `last_synced_at`.
- Poll interval controls (foreground / idle) and manual "Sync now".

## 7. Error handling

| Condition | Behavior |
|---|---|
| OAuth token expired | Silent refresh via `runagx.com/api/github/refresh`. |
| Refresh token revoked | Mark account disconnected. Banner on PRs page: "Reconnect GitHub". Cached data remains readable. |
| Rate limit (HTTP 403 with `X-RateLimit-Remaining: 0`) | Exponential backoff with jitter. Settings shows "Rate limited, retrying at HH:MM". |
| Network error | Silent retry on next tick. `last_synced_at` cursor unchanged. |
| Repo access lost (404 on repo sync) | Set `github_repos.access_revoked = 1`. Cached PRs read-only. Banner on that repo in settings. |
| PR deleted upstream | Next sync removes it from cache; `pr_links` cascades. |

## 8. Testing

- **Unit:** ID regex extraction (edge cases: `abc-123` rejected, `FOO-1` accepted, mid-word rejected); link-resolution order and first-match-wins; token refresh; recap prompt assembly.
- **Store:** SQLite migration up/down; upsert semantics on `github_prs`; polymorphic `pr_links` queries by target.
- **Adapter:** mocked GitHub API responses for list/get PR, list reviewers, list checks, list comments. Verify the `since`-cursor advance and that unchanged PRs don't trigger link re-resolution.
- **Integration:** OAuth flow against a staging `runagx.com` endpoint — manual in v1.
- **UI:** row-component parity test — same grouping/filter/pin/label code paths exercised with a PR row and a task row.

## 9. Rollout

1. Implement schema + store + OAuth (no UI surface) — verifiable via a test harness.
2. Add PRs page (list + detail) behind a feature flag.
3. Add linked-PRs section on task/issue detail.
4. Flip the feature flag on.

## 10. Open questions

- Do agx tasks currently expose a stable `PREFIX-N` identifier? If not, the implementation plan must add one (and decide the prefix convention — per-team? global `AGX-`?).
- Does the existing issue detail composer expose an agent-context hook we can reuse to inject PR context (title, body, comments, diff URL) into a new session? If not, we'll need a small extension.
- Where does the post-push hook live today (worktree lifecycle)? Need to locate and extend during implementation.
