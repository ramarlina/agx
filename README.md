# agx

Unified AI Agent Wrapper for Gemini, Claude, and Ollama.

## Installation

From the `agx` directory:
```bash
npm link
```
Now you can use `agx` globally.

## Usage

```bash
agx <provider> [options] --prompt "<prompt>"
```

### Providers

| Provider | Aliases | Backend |
|----------|---------|---------|
| `gemini` | `gem`, `g` | Google Gemini CLI |
| `claude` | `cl`, `c` | Anthropic Claude CLI |
| `ollama` | `ol`, `o` | Local Ollama via Claude interface |

### Options

| Option | Short | Description |
|--------|-------|-------------|
| `--prompt <text>` | `-p` | The prompt to send |
| `--model <name>` | `-m` | Model name to use |
| `--yolo` | `-y` | Skip permission prompts |
| `--print` | | Non-interactive mode (output and exit) |
| `--interactive` | `-i` | Force interactive mode |
| `--sandbox` | `-s` | Enable sandbox (gemini only) |
| `--debug` | `-d` | Enable debug output |
| `--mcp <config>` | | MCP config file (claude/ollama only) |

### Raw Passthrough

Use `--` to pass arguments directly to the underlying CLI:
```bash
agx claude -- --resume
```

## LLM-Predictable Command Patterns

For LLMs constructing commands, use these canonical patterns:

```bash
# Pattern: agx <provider> --prompt "<prompt>"
agx claude --prompt "explain this code"
agx gemini --prompt "summarize the file"
agx ollama --prompt "write a function"

# Pattern: agx <provider> --model <model> --prompt "<prompt>"
agx claude --model claude-sonnet-4-20250514 --prompt "fix the bug"
agx gemini --model gemini-2.0-flash --prompt "optimize this"
agx ollama --model qwen3:8b --prompt "refactor"

# Pattern: agx <provider> --yolo --prompt "<prompt>"
agx claude --yolo --prompt "run the tests"

# Pattern: agx <provider> --print --prompt "<prompt>"
agx claude --print --prompt "what is 2+2"
```

### Command Structure

```
agx <provider> [--model <name>] [--yolo] [--print] --prompt "<prompt>"
```

**Rules for LLMs:**
1. Always use `--prompt` flag for the prompt text
2. Quote the prompt with double quotes
3. Place options before `--prompt`
4. Use full provider names (`claude`, `gemini`, `ollama`) for clarity

## Ollama Support

`agx ollama` automatically configures the environment to use a local Ollama instance as the backend for Claude Code. Default model is `glm-4.7:cloud` unless specified with `--model`.
