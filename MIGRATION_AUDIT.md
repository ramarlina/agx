# AGX Migration Audit: index.js → lib/cli/runCli.js

**Date:** 2026-02-10
**Goal:** Enable index.js to become a thin wrapper around runCli.js

---

## Executive Summary

Both files implement the agx CLI but with different architectures:
- **index.js**: Monolithic ~8100 lines, all logic inline
- **runCli.js**: Modular ~3000 lines, delegates to command handlers in `lib/commands/`

The modular version (runCli.js) is nearly complete but has **several gaps**.

---

## Command Comparison Table

| Command | index.js | runCli.js | Notes |
|---------|:--------:|:---------:|-------|
| **Core Commands** | | | |
| `--version`, `-v` | ✅ | ✅ | Both handle identically |
| `init`, `setup` | ✅ | ✅ | Via `maybeHandleCoreCommand` |
| `config` | ✅ | ✅ | Via `maybeHandleCoreCommand` |
| `config cloud-url` | ✅ | ❌ | **GAP**: Not in core.js module |
| `status` | ✅ | ✅ | Via `maybeHandleCoreCommand` |
| `skill` | ✅ | ✅ | Via `maybeHandleCoreCommand` |
| `add`, `install` | ✅ | ✅ | Via `maybeHandleCoreCommand` |
| `test` | ✅ | ❌ | **GAP**: Creates test.txt, not in runCli |
| | | | |
| **Local Commands** | | | |
| `local:new`, `new --local` | ✅ | ✅ | Via `maybeHandleLocalCommand` |
| `local:tasks`, `tasks/ls --local` | ✅ | ✅ | Via `maybeHandleLocalCommand` |
| `local:show`, `show --local` | ✅ | ✅ | Via `maybeHandleLocalCommand` |
| `local:runs`, `runs --local` | ✅ | ✅ | Via `maybeHandleLocalCommand` |
| `local:complete` | ✅ | ✅ | Via `maybeHandleLocalCommand` |
| `gc` | ✅ | ✅ | Via `maybeHandleLocalCommand` |
| `local:run`, `run --local` | ✅ | ✅ | Via `maybeHandleLocalCommand` |
| `unlock`, `local:unlock` | ✅ | ✅ | Via `maybeHandleLocalCommand` |
| `tail`, `local:tail` | ✅ | ✅ | Via `maybeHandleLocalCommand` |
| | | | |
| **Cloud Task Commands** | | | |
| `new` | ✅ | ✅ | Inline in both |
| `push` | ✅ | ✅ | Alias for `new` |
| `run` | ✅ | ✅ | Inline in both |
| `task run` | ✅ | ✅ | Docker-style alias |
| `reset`, `task reset` | ✅ | ✅ | Inline in both |
| `task update` | ✅ | ❌ | **GAP**: Not in runCli.js |
| `retry`, `task retry` | ✅ | ✅ | Inline in both |
| `task ls`, `list`, `ls`, `tasks` | ✅ | ✅ | Inline in both |
| `complete`, `done` | ✅ | ✅ | Inline in both |
| `watch` | ✅ | ✅ | Inline in both |
| `comments clear` | ✅ | ✅ | Inline in both |
| `comments ls` | ✅ | ✅ | Inline in both |
| `comments tail` | ✅ | ✅ | Inline in both |
| `logs clear` | ✅ | ✅ | Inline in both |
| `logs ls` | ✅ | ✅ | Inline in both |
| `logs tail` | ✅ | ✅ | Inline in both |
| `task logs` | ✅ | ✅ | Inline in both |
| `task tail` | ✅ | ✅ | Inline in both |
| `task stop` | ✅ | ✅ | Inline in both |
| `task clear` | ✅ | ✅ | Inline in both |
| `task rm` | ✅ | ✅ | Inline in both |
| | | | |
| **Daemon Commands** | | | |
| `daemon` (foreground) | ✅ | ✅ | Via `maybeHandleDaemonBoardCommand` |
| `daemon run` | ✅ | ✅ | Via `maybeHandleDaemonBoardCommand` |
| `daemon start` | ✅ | ✅ | Via `maybeHandleDaemonBoardCommand` |
| `daemon stop` | ✅ | ✅ | Via `maybeHandleDaemonBoardCommand` |
| `daemon status` | ✅ | ✅ | Via `maybeHandleDaemonBoardCommand` |
| `daemon logs` | ✅ | ✅ | Via `maybeHandleDaemonBoardCommand` |
| `daemon tail` | ✅ | ✅ | Via `maybeHandleDaemonBoardCommand` |
| | | | |
| **Board Commands** | | | |
| `board start` | ✅ | ✅ | Via `maybeHandleDaemonBoardCommand` |
| `board stop` | ✅ | ✅ | Via `maybeHandleDaemonBoardCommand` |
| `board status` | ✅ | ✅ | Via `maybeHandleDaemonBoardCommand` |
| `board show` | ✅ | ✅ | Via `maybeHandleDaemonBoardCommand` |
| `board open` | ✅ | ✅ | Via `maybeHandleDaemonBoardCommand` |
| `board logs` | ✅ | ✅ | Via `maybeHandleDaemonBoardCommand` |
| `board tail` | ✅ | ✅ | Via `maybeHandleDaemonBoardCommand` |
| `board migrate` | ✅ | ✅ | Via `maybeHandleDaemonBoardCommand` |
| | | | |
| **Container Commands** | | | |
| `container ls` | ✅ | ✅ | Inline in both |
| `container logs` | ✅ | ✅ | Inline in both |
| `container stop` | ✅ | ✅ | Inline in both |
| | | | |
| **Project Commands** | | | |
| `project list` | ✅ | ✅ | Via `maybeHandleProjectCommand` |
| `project get` | ✅ | ✅ | Via `maybeHandleProjectCommand` |
| `project create` | ✅ | ✅ | Via `maybeHandleProjectCommand` |
| `project update` | ✅ | ✅ | Via `maybeHandleProjectCommand` |
| `project assign` | ✅ | ✅ | Via `maybeHandleProjectCommand` |
| `project unassign` | ✅ | ✅ | Via `maybeHandleProjectCommand` |
| | | | |
| **Other Commands** | | | |
| `workflow` | ✅ | ✅ | Via `maybeHandleWorkflowCommand` |
| `logout` | ✅ | ✅ | Inline in both |
| `audit` | ✅ | ✅ | Inline in both |
| `security status` | ✅ | ✅ | Inline in both |
| `security rotate` | ✅ | ✅ | Inline in both |
| `update` | ✅ | ✅ | Inline in both |
| `update --auto` | ✅ | ✅ | Inline in both |
| `update --off` | ✅ | ✅ | Inline in both |
| `update status` | ✅ | ✅ | Inline in both |
| | | | |
| **Provider Pass-through** | | | |
| `claude`, `c`, `cl` | ✅ | ✅ | Provider aliases handled |
| `gemini`, `g`, `gem` | ✅ | ✅ | Provider aliases handled |
| `ollama`, `o`, `ol` | ✅ | ✅ | Provider aliases handled |
| `codex`, `x` | ✅ | ✅ | Provider aliases handled |
| | | | |
| **Interactive Menu** | | | |
| (no args) → menu | ✅ | ✅ | Via `runInteractiveMenu` |

---

## Identified Gaps

### 1. Missing Command: `config cloud-url`
**Location in index.js:** Lines 4631-4644
```javascript
if (configSubcmd === 'cloud-url') {
  const newUrl = args[2];
  if (!newUrl) {
    // Show current URL
  }
  // Set new URL
}
```
**Status in runCli.js:** Not handled - `maybeHandleCoreCommand` only handles `config` without subcommand.

### 2. Missing Command: `test`
**Location in index.js:** Lines 4665-4679
```javascript
if (cmd === 'test') {
  // Creates test.txt file in cwd
}
```
**Status in runCli.js:** Not present at all.

### 3. Missing Command: `task update`
**Location in index.js:** Lines 5874-5929
```javascript
if (cmd === 'task' && args[1] === 'update') {
  // Updates task provider/model/status
}
```
**Status in runCli.js:** Not present.

---

## Helper Functions & Constants Comparison

### Constants Present in Both ✅
- `CONFIG_DIR`, `CONFIG_FILE`
- `SWARM_PROVIDERS`, `SWARM_TIMEOUT_MS`, `SWARM_RETRIES`
- `SWARM_MAX_ITERS`, `SINGLE_MAX_ITERS`
- `VERIFY_TIMEOUT_MS`, `VERIFY_PROMPT_MAX_CHARS`
- `SWARM_LOG_FLUSH_MS`, `SWARM_LOG_MAX_BYTES`
- `PROVIDER_ALIASES`

### Functions in index.js → Modularized Location in runCli.js

| Function | index.js | runCli.js Location |
|----------|----------|-------------------|
| `c` (colors) | Inline | `lib/ui/colors.js` ✅ |
| `AGX_SKILL` | Inline | `lib/cli/skillText.js` ✅ |
| `sanitizeCliArg` | Inline | `lib/cli/sanitize.js` ✅ |
| `loadCloudConfigFile` | Inline | `lib/config/cloudConfig.js` ✅ |
| `truncateForComment` | Inline | `lib/ui/text.js` ✅ |
| `commandExists` | Inline | `lib/proc/commandExists.js` ✅ |
| `spawnCloudTaskProcess` | Inline | `lib/proc/spawnCloudTaskProcess.js` ✅ |
| `sleep` | Inline | `lib/cli/util.js` ✅ |
| `extractJson` | Inline | `lib/cli/util.js` ✅ |
| `extractJsonLast` | Inline | `lib/cli/util.js` ✅ |
| `truncateForPrompt` | Inline | `lib/cli/util.js` ✅ |
| `ensureNextPrompt` | Inline | `lib/cli/util.js` ✅ |
| `ensureExplanation` | Inline | `lib/cli/util.js` ✅ |
| `randomId` | Inline | `lib/cli/util.js` ✅ |
| `appendTail` | Inline | `lib/cli/util.js` ✅ |
| `loadConfig`, `saveConfig` | Inline | `lib/cli/configStore.js` ✅ |
| `detectProviders` | Inline | `lib/cli/providers.js` ✅ |
| `runInteractive`, `runSilent` | Inline | `lib/cli/providers.js` ✅ |
| `installProvider`, `loginProvider` | Inline | `lib/cli/providers.js` ✅ |
| `runOnboarding` | Inline | `lib/cli/onboarding.js` ✅ |
| `showConfigStatus`, `runConfigMenu` | Inline | `lib/cli/onboarding.js` ✅ |
| `handleSkillCommand` | Inline | `lib/cli/skills.js` ✅ |
| `runInteractiveMenu` | Inline | `lib/cli/interactiveMenu.js` ✅ |
| `createCloudRunner` | N/A | `lib/cli/cloud.js` ✅ (new pattern) |
| Cloud artifact helpers | Inline | `lib/cli/cloudArtifacts.js` ✅ |
| Daemon helpers | Inline | `lib/cli/daemon.js` ✅ |
| Prompt builders | Inline | `lib/prompts/cloudTask.js` ✅ |

### Functions in index.js NOT in lib/

| Function | Description | Action Needed |
|----------|-------------|---------------|
| `postLearning` | Post learning to cloud | Check if needed |
| `extractSection` | Extract markdown section | Used by both - may be duplicated |
| `normalizeTicketType` | Normalize ticket type | In both - check consistency |
| `parseFrontmatterFromContent` | Parse frontmatter | Used by both |
| `resolveTaskTicketType` | Resolve task ticket type | In cloudArtifacts ✅ |
| `parseList` | Parse list values | In cloudArtifacts ✅ |

---

## Architecture Differences

### runCli.js Uses Factory Pattern
```javascript
const cloudRunner = createCloudRunner({...deps...});
const { patchTaskState, createTaskLogger, ... } = cloudRunner;
```
This provides better testability and dependency injection.

### index.js Has Everything Inline
All cloud runner functions are defined directly in the file.

---

## Migration Checklist

### High Priority (Blocking Migration)

- [ ] **Add `config cloud-url` to lib/commands/core.js**
  - Read/write cloud URL from config
  
- [ ] **Add `task update` command**
  - Either in lib/commands/task.js (new file) or inline in runCli.js
  - Supports: `--provider`, `--model`, `--status`

### Medium Priority (Feature Parity)

- [ ] **Add `test` command**
  - Simple file creation test
  - Possibly add to lib/commands/core.js

- [ ] **Verify `postLearning` function**
  - Check if called and working in runCli.js path

### Low Priority (Nice to Have)

- [ ] Extract remaining inline commands to command modules
  - `watch`, `comments *`, `logs *` → lib/commands/stream.js
  - `container *` → lib/commands/container.js
  - `audit`, `security`, `update` → lib/commands/admin.js

### Testing Needed

- [ ] Run `agx config cloud-url` in both
- [ ] Run `agx task update <id> --provider claude` in both
- [ ] Run `agx test` in both
- [ ] Verify all `--help` outputs match
- [ ] Verify interactive menu works identically

---

## Recommended Approach

1. **Add missing commands to runCli.js** (3 commands)
2. **Test thoroughly** comparing index.js vs runCli.js
3. **Update index.js** to be thin wrapper:
   ```javascript
   #!/usr/bin/env node
   const { runCli } = require('./lib/cli/runCli');
   runCli(process.argv).catch(console.error);
   ```
4. **Deprecate** index.js monolithic code over time

---

## Files to Modify

1. `lib/commands/core.js` - Add `config cloud-url` handling
2. `lib/cli/runCli.js` - Add `task update` command (inline)
3. `lib/commands/core.js` - Add `test` command
4. `index.js` - Eventually replace with thin wrapper

