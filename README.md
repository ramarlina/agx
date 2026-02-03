# agx

Unified AI Agent Wrapper for Gemini, Claude, and Ollama.

## Installation

### Via npm (recommended)

```bash
npm install -g @mndrk/agx
```

### From source

Clone the repository and link locally:

```bash
git clone https://github.com/ramarlina/agx.git
cd agx
npm link
```

## Quick Start

When you run `agx` for the first time, it will automatically start the setup wizard:

```bash
agx
```

The setup wizard will:
1. Detect which AI providers are installed on your system
2. Guide you through installing any missing providers
3. Help you authenticate with your chosen providers
4. Set your default provider

After setup, you can start using agx immediately:

```bash
agx --prompt "hello world"
```

## Usage

### With Default Provider

Once configured, you can run prompts without specifying a provider:

```bash
agx --prompt "explain this code"
agx -p "summarize the file"
```

### With Specific Provider

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

## Configuration Commands

### `agx init`

Run the setup wizard manually. This is useful if you want to reconfigure agx or add new providers:

```bash
agx init
```

The wizard will:
- Detect installed providers (claude, gemini, ollama)
- Guide you through installation and authentication
- Let you set or change your default provider

### `agx config`

Open an interactive configuration menu to manage your agx settings:

```bash
agx config
```

### `agx add <provider>`

Install a specific AI provider:

```bash
agx add claude    # Install Claude CLI
agx add gemini    # Install Gemini CLI
agx add ollama    # Install Ollama
```

### `agx login <provider>`

Authenticate with a provider:

```bash
agx login claude    # Login to Claude
agx login gemini    # Login to Gemini
```

### `agx status`

View your current configuration, including installed providers and default settings:

```bash
agx status
```

Example output:
```
agx Configuration Status
------------------------
Default Provider: claude

Installed Providers:
  ✓ claude (authenticated)
  ✓ gemini (authenticated)
  ✓ ollama (running)

Config file: ~/.agx/config.json
```

## Skill System

agx includes a skill system that helps AI agents understand how to use agx effectively.

### `agx skill`

View the agx skill (LLM instructions):

```bash
agx skill
```

This displays the skill file that describes agx's capabilities and usage patterns for AI agents.

### `agx skill install`

Install the agx skill to Claude and/or Gemini so AI agents know how to use agx:

```bash
agx skill install
```

This adds the agx skill to your AI provider's skill directory, enabling features like:
- AI agents can call other AI providers through agx
- Cross-provider collaboration (e.g., Claude can ask Gemini for help)
- Consistent command patterns across all providers

## LLM-Predictable Command Patterns

For LLMs constructing commands, use these canonical patterns:

```bash
# Pattern: agx --prompt "<prompt>" (uses default provider)
agx --prompt "explain this code"

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
agx [provider] [--model <name>] [--yolo] [--print] --prompt "<prompt>"
```

**Rules for LLMs:**
1. Always use `--prompt` flag for the prompt text
2. Quote the prompt with double quotes
3. Place options before `--prompt`
4. Use full provider names (`claude`, `gemini`, `ollama`) for clarity
5. Provider is optional if a default is configured

## Configuration File

agx stores its configuration in `~/.agx/config.json`:

```json
{
  "defaultProvider": "claude",
  "providers": {
    "claude": {
      "installed": true,
      "authenticated": true
    },
    "gemini": {
      "installed": true,
      "authenticated": true
    },
    "ollama": {
      "installed": true
    }
  }
}
```

## Ollama Support

`agx ollama` automatically configures the environment to use a local Ollama instance as the backend for Claude Code. Default model is `glm-4.7:cloud` unless specified with `--model`.
