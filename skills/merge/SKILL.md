---
name: merge
description: Use when the user invokes /merge - merges the current PR, cleans up, and pulls the default branch
---

# Merge

Merge the PR for the current branch, clean up, and pull latest.

## Steps

### 0. Pre-check: ensure committed and PR exists

1. If there are staged/unstaged changes or untracked files, run the `/commit` workflow first.
2. If no PR exists for the current branch (`gh pr view` fails), run the `/pr` workflow first.
3. Then continue below.

### 1. Gather context

- `git branch --show-current` — current branch
- `git remote show origin 2>/dev/null | grep 'HEAD branch'` — default branch
- `gh pr view --json state,mergeable,title` — PR status

### 2. Merge

- `gh pr merge --squash --delete-branch`
- If merge fails (checks pending, reviews required), stop and tell the user why

### 3. Clean up and pull

**If in a worktree** (parent repo exists at `../<original-repo>`):
- `cd` back to the original repo directory
- `git worktree remove ../<worktree-dir>`
- `git checkout <default-branch> && git pull`

**If in the main repo:**
- `git checkout <default-branch> && git pull`
- `git branch -d <branch>` (if not already deleted by `--delete-branch`)

### 4. Done

Confirm clean state with `git status`.

## Rules

- Never force merge
- If PR is not mergeable, report the reason — don't work around it
