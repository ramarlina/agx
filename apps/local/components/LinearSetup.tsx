"use client";

import { useState } from "react";
import { Check, ExternalLink, Loader2 } from "lucide-react";

interface CliStatus {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
}

type McpStatus = Record<string, boolean>;

interface LinearSetupProps {
  connected: boolean;
  user: { name: string; email: string } | null;
  clis: CliStatus;
  mcpConfigured: McpStatus;
  onConnect: () => void;
  onConnectWithKey: (apiKey: string) => Promise<{ ok: boolean; error?: string }>;
  onDisconnect: () => Promise<void>;
  onConfigureMcp: (cli: string) => Promise<{ ok: boolean; error?: string }>;
  onContinue: () => void;
}

const CLI_PROVIDERS = [
  { id: "claude" as const, label: "Claude Code", icon: "🟣" },
  { id: "codex" as const, label: "Codex", icon: "⚫" },
  { id: "gemini" as const, label: "Gemini CLI", icon: "🔵" },
];

export default function LinearSetup({
  connected,
  user,
  clis,
  mcpConfigured,
  onConnect,
  onConnectWithKey,
  onDisconnect,
  onConfigureMcp,
  onContinue,
}: LinearSetupProps) {
  const [apiKey, setApiKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [configuringCli, setConfiguringCli] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);

  const handleKeySubmit = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setKeyError(null);
    const result = await onConnectWithKey(apiKey.trim());
    setSaving(false);
    if (!result.ok) {
      setKeyError(result.error || "Failed to connect");
    }
  };

  const handleConfigureMcp = async (cli: string) => {
    setConfiguringCli(cli);
    setMcpError(null);
    const result = await onConfigureMcp(cli);
    setConfiguringCli(null);
    if (!result.ok) {
      setMcpError(result.error || "Failed to configure");
    }
  };

  const installedProviders = CLI_PROVIDERS.filter((p) => clis[p.id]);
  const hasAnyMcpConfigured = installedProviders.some((p) => mcpConfigured[p.id]);

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-md space-y-6 px-6">
        {/* Step 1: App Connection */}
        <div>
          <div className="flex items-center gap-2">
            {connected && (
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500/20">
                <Check size={10} className="text-green-500" />
              </div>
            )}
            <h2 className="text-sm font-semibold text-[var(--foreground)]">
              Connect to Linear
            </h2>
          </div>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Connect your workspace to browse tickets and execute them with
            agents.
          </p>
          <div className="mt-3 space-y-3">
            {connected ? (
              <div className="flex items-center justify-between rounded-md border border-[var(--card-border)] px-3 py-2">
                <div className="text-xs text-[var(--foreground)]">
                  Connected as{" "}
                  <span className="font-medium">{user?.name}</span>
                </div>
                <button
                  type="button"
                  onClick={onDisconnect}
                  className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onConnect}
                  className="w-full rounded-md bg-[var(--foreground)] px-4 py-2 text-xs font-medium text-[var(--card-bg)] transition-opacity hover:opacity-90"
                >
                  Connect with Linear
                </button>

                <div className="flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
                  <div className="flex-1 border-t border-[var(--card-border)]" />
                  or
                  <div className="flex-1 border-t border-[var(--card-border)]" />
                </div>

                <div>
                  <label className="text-[10px] text-[var(--muted-foreground)] block mb-1">
                    Personal API key
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => { setApiKey(e.target.value); setKeyError(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") handleKeySubmit(); }}
                      placeholder="lin_api_..."
                      className="flex-1 rounded-md border border-[var(--card-border)] bg-transparent px-3 py-1.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                    />
                    <button
                      type="button"
                      onClick={handleKeySubmit}
                      disabled={!apiKey.trim() || saving}
                      className="rounded-md border border-[var(--card-border)] px-3 py-1.5 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--card-border)] disabled:opacity-40"
                    >
                      {saving ? "..." : "Save"}
                    </button>
                  </div>
                  {keyError && (
                    <p className="mt-1 text-[10px] text-red-400">{keyError}</p>
                  )}
                  <a
                    href="https://linear.app/settings/api"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                  >
                    Generate at linear.app/settings/api
                    <ExternalLink size={8} />
                  </a>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Step 2: MCP Setup — only show after connected */}
        {connected && (
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">
              Configure MCP
            </h2>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Add the Linear MCP server to your AI tools so agents can read and
              update tickets during execution.
            </p>
            <div className="mt-3 space-y-1">
              {CLI_PROVIDERS.map((provider) => {
                const installed = clis[provider.id];
                const configured = mcpConfigured[provider.id];
                const isConfiguring = configuringCli === provider.id;

                return (
                  <div
                    key={provider.id}
                    className={`flex items-center justify-between rounded-md border border-[var(--card-border)] px-3 py-2 ${
                      !installed ? "opacity-40" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <span>{provider.icon}</span>
                      <span className="text-[var(--foreground)]">
                        {provider.label}
                      </span>
                    </div>
                    {!installed ? (
                      <span className="text-[10px] text-[var(--muted-foreground)]">
                        Not installed
                      </span>
                    ) : configured ? (
                      <span className="flex items-center gap-1 text-[10px] text-green-500">
                        <Check size={10} />
                        Configured
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleConfigureMcp(provider.id)}
                        disabled={isConfiguring}
                        className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-[var(--foreground)] border border-[var(--card-border)] hover:bg-[var(--card-border)] transition-colors disabled:opacity-50"
                      >
                        {isConfiguring ? (
                          <>
                            <Loader2 size={10} className="animate-spin" />
                            Configuring...
                          </>
                        ) : (
                          "Configure"
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
              {mcpError && (
                <p className="mt-1 text-[10px] text-red-400">{mcpError}</p>
              )}
            </div>

            {/* Continue button */}
            <button
              type="button"
              onClick={onContinue}
              className="mt-4 w-full rounded-md bg-[var(--foreground)] px-4 py-2 text-xs font-medium text-[var(--card-bg)] transition-opacity hover:opacity-90"
            >
              {hasAnyMcpConfigured ? "Continue" : "Skip for now"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
