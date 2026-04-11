---
name: pr
description: Use when the user invokes /pr - pushes the current branch and creates a pull request
---

# PR

Push the current branch and open a pull request.

## Steps

### 1. Gather context (parallel)

- `git branch --show-current` — current branch
- `git remote show origin 2>/dev/null | grep 'HEAD branch'` — default branch
- `git log --oneline <default-branch>..HEAD` — commits in this branch
- `git diff <default-branch>...HEAD` — full diff against default branch

### 2. Push

- `git push -u origin <branch>`

### 3. Create PR

- `gh pr create --base <default-branch> --title "..." --body "..."`
- Short title (under 70 chars)
- Body format:

```
## Summary
<1-3 bullet points>

## Test plan
<bulleted checklist>
```

- **No "Generated with Claude Code" or similar attribution lines**

### 4. Done

Report the PR URL. Stop here — use `/merge` to merge it.

## Rules

- Never force push
- If the branch has no commits ahead of default, warn and stop
