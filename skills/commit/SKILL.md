---
name: commit
description: Use when the user invokes /commit - stages and commits current changes, creating a branch from main if needed via worktree
---

# Commit

Stage and commit changes. If on the default branch, create a feature branch first.

## Steps

### 1. Gather context (parallel)

- `git status` — see all changes
- `git diff` + `git diff --staged` — what changed
- `git log --oneline -10` — commit style
- `git branch --show-current` — current branch
- `git remote show origin 2>/dev/null | grep 'HEAD branch'` — default branch name

### 2. If on the default branch: create a worktree branch

1. Generate a short descriptive branch name (e.g., `fix/login-validation`, `feat/add-search`)
2. `git stash --include-untracked`
3. `git worktree add -b <branch> ../<repo>-<branch> HEAD`
4. `cd ../<repo>-<branch> && git stash pop`
5. Continue from step 3 inside the worktree

### 3. Stage and commit

- Stage files by name (never `git add -A` or `git add .`)
- Never stage secrets (`.env`, credentials, tokens)
- Commit message: follow repo's existing style, focus on "why"
- **No Co-Authored-By line**
- Use heredoc format for the message

### 4. Done

Report what was committed. Stop here — use `/pr` to push and create a PR.

## Rules

- Never force push or skip hooks
- Never commit secrets
- If pre-commit hook fails: fix, re-stage, new commit (never amend)
