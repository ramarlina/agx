export type ProviderId = "claude" | "gemini" | "ollama" | "codex" | "zai";

export interface ProviderCliDefinition {
  id: ProviderId;
  label: string;
  bin: string;
  description: string;
  installCmd: string;
  docsUrl: string;
  recommended?: boolean;
  installNote?: string;
  statusLabel?: string;
  authCheck?: { cmd: string; timeout: number };
  authCmd?: { cmd: string; description: string };
}

export const PROVIDER_CLIS: ProviderCliDefinition[] = [
  {
    id: "claude",
    label: "Claude Code",
    bin: "claude",
    description: "Recommended for the fastest AGX setup.",
    installCmd: "npm install -g @anthropic-ai/claude-code",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/quickstart",
    recommended: true,
    statusLabel: "Installed",
    authCheck: { cmd: 'claude -p "say yes" 2>/dev/null', timeout: 15_000 },
    authCmd: { cmd: "claude", description: "Opens browser for Anthropic login" },
  },
  {
    id: "codex",
    label: "Codex",
    bin: "codex",
    description: "OpenAI's terminal coding agent.",
    installCmd: "npm install -g @openai/codex",
    docsUrl: "https://github.com/openai/codex",
    statusLabel: "Installed",
    authCheck: { cmd: "codex --version 2>/dev/null", timeout: 5_000 },
    authCmd: {
      cmd: "codex login --device-auth",
      description: "Device auth flow for OpenAI",
    },
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    bin: "gemini",
    description: "Google's CLI for Gemini workflows.",
    installCmd: "npm install -g @google/gemini-cli",
    docsUrl: "https://github.com/google-gemini/gemini-cli",
    statusLabel: "Installed",
    authCheck: { cmd: 'echo "hi" | gemini 2>/dev/null', timeout: 15_000 },
    authCmd: {
      cmd: "gemini",
      description: "Opens browser for Google login",
    },
  },
  {
    id: "ollama",
    label: "Ollama",
    bin: "ollama",
    description: "Run local models on your machine.",
    installCmd: "curl -fsSL https://ollama.com/install.sh | sh",
    docsUrl: "https://ollama.com/download",
    statusLabel: "Installed",
    authCheck: { cmd: "ollama list 2>/dev/null", timeout: 5_000 },
  },
  {
    id: "zai",
    label: "Z.AI",
    bin: "claude",
    description: "Use the Claude CLI with your Z.AI API key.",
    installCmd: "npm install -g @anthropic-ai/claude-code",
    docsUrl: "https://z.ai/",
    installNote: "Requires Claude Code plus a configured Z.AI API key.",
    statusLabel: "Via Claude CLI",
    authCheck: { cmd: 'test -n "$ANTHROPIC_API_KEY"', timeout: 5_000 },
    authCmd: {
      cmd: "export ANTHROPIC_API_KEY=<your-key>",
      description: "Set your Z.AI API key",
    },
  },
];
