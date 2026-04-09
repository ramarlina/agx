---
name: agx
description: Use when working on the AGX CLI or its cloud-backed task/project workflows. Covers task lifecycle commands, project assignment, repo attachment with local analysis, daemon/board flows, and the wake-work-sleep execution model.
---

# AGX

AGX is a cloud-backed task orchestrator with a local CLI. Use this skill when changing AGX itself or when you need the exact CLI flows and mental model.

## Model

AGX agents are stateless between runs. Continuity comes from persisted API state:

`WAKE -> load state -> WORK -> persist state -> SLEEP`

Treat the CLI as a client for the cloud API plus local runtime helpers like daemon, board, and repo analysis.

## Core CLI flows

```bash
agx init
agx -p "explain this code"
agx new "Build a REST API with auth"
agx run <task-id-or-slug>
agx -a -p "Build a REST API with auth"
```

## Tasks

```bash
agx new "<goal>"
agx run <task-id-or-slug>
agx status [task-id-or-slug]
agx complete <task-id>
agx retry <task-id-or-slug> [--from <stage>]
agx deps <task> [--depends-on <task> ... | --clear]
agx task ls
agx task logs <id>
agx task stop <id>
```

Task identifiers usually accept UUIDs, slugs, or cached `#N` references.

## Projects and repos

Use projects to scope task ownership and attach repo context.

```bash
agx project list
agx project get <id-or-slug>
agx project create --name <name>
agx project update <id-or-slug> [flags]
agx project delete <id-or-slug>
agx project assign <project> --task <task>
agx project unassign --task <task>
agx new "goal" --project <project-id-or-slug>
```

Attach a repo from the current directory:

```bash
agx repo add . --project <project-id-or-slug>
```

What `agx repo add` does:

- resolves the repo root from the supplied path
- analyzes local signals like `package.json`, lockfiles, scripts, key config files, and `README.md`
- generates repo notes
- appends the repo entry to the target project through the cloud API

Optional flags:

```bash
agx repo add . --project <project> --name <display-name>
agx repo add . --project <project> --notes "extra notes"
agx repo add . --project <project> --json
```

## Scheduling

Manage recurring prompt jobs that run on a cron schedule via agx-cloud.

```bash
agx schedule ls [--state active|paused|stopped] [--project <id>]
agx schedule create "name" --cadence "every day" --prompt "do the thing"
agx schedule create "name" --cadence "0 9 * * 1" --prompt-file ./tasks/weekly.md
agx schedule get <id>
agx schedule update <id> --cadence "every 2 hours" --name "new name"
agx schedule pause <id>
agx schedule resume <id>
agx schedule rm <id>
agx schedule runs <id>
agx schedule cancel <id>
```

- `--cadence` accepts natural language ("every day", "every 2 hours") or cron expressions ("0 9 * * 1")
- `--prompt-file` reads the prompt from a file (useful for long prompts)
- Provider and model default to null; the runtime resolves the environment default
- `--overlap skip|queue|allow` controls what happens when a run is still active
- `--catch-up fire_once|replay_all|skip` controls behavior for missed runs

## Daemon and board

```bash
agx board start
agx board stop
agx board show
agx daemon start
agx daemon stop
agx daemon status
```

Use these when validating end-to-end queue execution or dashboard behavior.

## Providers

```bash
agx claude [args]
agx codex [args]
agx gemini [args]
agx ollama [args]
```

Aliases:

- `claude` -> `c`
- `codex` -> `x`
- `gemini` -> `g`
- `ollama` -> `o`

## Flags that matter

```bash
-p, --prompt
-P, --provider
-m, --model
-a, --autonomous
-y, --yolo
--swarm
```

Notes:

- `-a` is the full autonomous path: create task, start daemon, and work until done.
- `-y` skips confirmations during execution and is typically paired with autonomous runs.
- Project-aware task creation should prefer `--project <id-or-slug>`.

## When editing AGX

- Keep CLI help text, README command examples, and command implementations aligned.
- Prefer wiring new behavior through existing `cloudRequest` and project-resolution helpers instead of creating parallel API clients.
- For project/repo mutations, preserve existing repo entries when patching `repos`.
