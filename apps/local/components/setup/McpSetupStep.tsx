// components/setup/McpSetupStep.tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Check, Loader2, ExternalLink, Plug, Terminal } from "lucide-react";
import TerminalPane, { type TerminalPaneHandle } from "@/components/terminal/TerminalPane";
import { SetupLayout } from "./SetupLayout";

interface McpServer {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
}

const MCP_SERVERS: McpServer[] = [
  {
    id: "linear",
    name: "Linear",
    description: "Read and update tickets so agents can track work in Linear during execution.",
    docsUrl: "https://linear.app/docs/mcp",
  },
];

type McpStatus = Record<string, boolean>;
type CliStatus = Record<string, boolean>;

interface McpSetupStepProps {
  onFinish: () => void;
  onBack: () => void;
}

const CLI_PROVIDERS: { id: string; label: string; launchCmd: string }[] = [
  { id: "claude", label: "Claude Code", launchCmd: "claude" },
  { id: "codex", label: "Codex", launchCmd: "codex" },
  { id: "gemini", label: "Gemini CLI", launchCmd: "gemini" },
];

export function McpSetupStep({ onFinish, onBack }: McpSetupStepProps) {
  const [loading, setLoading] = useState(true);
  const [clis, setClis] = useState<CliStatus>({});
  const [mcpConfigured, setMcpConfigured] = useState<McpStatus>({});
  const [configuringCli, setConfiguringCli] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const termRef = useRef<TerminalPaneHandle>(null);

  const runInTerminal = useCallback((cmd: string) => {
    termRef.current?.sendCommand(cmd);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [statusRes, mcpRes] = await Promise.all([
        fetch("/api/linear/status"),
        fetch("/api/linear/mcp-setup"),
      ]);
      const statusData = await statusRes.json();
      const mcpData = await mcpRes.json();
      setClis(statusData.clis ?? {});
      setMcpConfigured(mcpData.configured ?? {});
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleConfigureMcp = useCallback(async (cli: string) => {
    setConfiguringCli(cli);
    setMcpError(null);
    try {
      const res = await fetch("/api/linear/mcp-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cli }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMcpError(data.error || "Failed to configure MCP");
      } else {
        await refresh();
      }
    } catch {
      setMcpError("Failed to configure MCP");
    } finally {
      setConfiguringCli(null);
    }
  }, [refresh]);

  const installedProviders = CLI_PROVIDERS.filter((p) => clis[p.id]);
  const hasAnyConfigured = installedProviders.some((p) => mcpConfigured[p.id]);

  return (
    <SetupLayout
      currentStep={2}
      totalSteps={2}
      wide
      footer={
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="text-[14px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onFinish}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-[var(--foreground)] text-[var(--background)] text-[14px] font-semibold rounded-lg hover:opacity-90 transition-all"
          >
            {hasAnyConfigured ? "Finish" : "Skip"}
          </button>
        </div>
      }
    >
      <div className="text-center mb-8">
        <h1 className="text-[24px] font-bold text-[var(--foreground)] tracking-tight">
          Configure MCP Servers
        </h1>
        <p className="mt-2 text-[14px] text-[var(--muted-foreground)] leading-relaxed">
          MCP servers let your agents interact with external tools. After registering a server below,
          launch your CLI in the terminal to complete the OAuth login.
        </p>
      </div>

      <div className="flex gap-6 min-h-0 items-start">
        {/* Left column — MCP servers list */}
        <div className="w-[380px] shrink-0 space-y-6">
          {loading ? (
            <div className="text-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--muted-foreground)] mx-auto" />
              <p className="mt-3 text-[13px] text-[var(--muted-foreground)]">
                Checking MCP configuration...
              </p>
            </div>
          ) : (
            <>
              {MCP_SERVERS.map((server) => (
                <div
                  key={server.id}
                  className="border border-[var(--card-border)] rounded-lg overflow-hidden"
                >
                  <div className="px-4 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[var(--secondary)] flex items-center justify-center">
                      <Plug className="w-4 h-4 text-[var(--foreground)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-semibold text-[var(--foreground)]">
                          {server.name}
                        </span>
                        {hasAnyConfigured && (
                          <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded">
                            Registered
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-[var(--muted-foreground)]">
                        {server.description}
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-[var(--card-border)] px-4 py-3 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2">
                      Register & authenticate per CLI
                    </p>
                    {CLI_PROVIDERS.map((provider) => {
                      const installed = clis[provider.id];
                      const configured = mcpConfigured[provider.id];
                      const isConfiguring = configuringCli === provider.id;

                      return (
                        <div
                          key={provider.id}
                          className={`flex items-center justify-between rounded-md border border-[var(--card-border)] px-3 py-2.5 ${
                            !installed ? "opacity-40" : ""
                          }`}
                        >
                          <span className="text-[13px] text-[var(--foreground)]">
                            {provider.label}
                          </span>
                          {!installed ? (
                            <span className="text-[11px] text-[var(--muted-foreground)]">
                              Not installed
                            </span>
                          ) : configured ? (
                            <div className="flex items-center gap-2">
                              <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                                <Check className="w-3.5 h-3.5" />
                                Registered
                              </span>
                              <button
                                type="button"
                                onClick={() => runInTerminal(provider.launchCmd)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border border-[var(--card-border)] hover:bg-[var(--secondary)] transition-colors"
                                title={`Launch ${provider.label} to authenticate`}
                              >
                                Launch & authenticate
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleConfigureMcp(provider.id)}
                              disabled={isConfiguring}
                              className="inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium rounded-md border border-[var(--card-border)] hover:bg-[var(--secondary)] transition-colors disabled:opacity-50"
                            >
                              {isConfiguring ? (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Registering...
                                </>
                              ) : (
                                "Register"
                              )}
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {mcpError && (
                      <p className="text-[12px] text-red-500 dark:text-red-400 mt-1">
                        {mcpError}
                      </p>
                    )}
                  </div>

                  <div className="border-t border-[var(--card-border)] px-4 py-2.5">
                    <a
                      href={server.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                    >
                      Learn more about {server.name} MCP
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ))}

              {installedProviders.length === 0 && (
                <div className="text-center py-4">
                  <p className="text-[13px] text-[var(--muted-foreground)]">
                    No CLI providers detected. Go back and install a provider first, or skip this step.
                  </p>
                </div>
              )}

              <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                Registering writes the MCP server into the CLI config. You still need to launch the CLI
                (right) and complete the interactive OAuth flow (usually <code className="text-[var(--foreground)]">/mcp</code>).
              </p>
            </>
          )}
        </div>

        {/* Right column — embedded terminal */}
        <div className="flex-1 min-w-0 h-[500px] flex flex-col rounded-xl border border-[var(--card-border)] overflow-hidden bg-[#1e1e1e]">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--card-border)] bg-[var(--secondary)] shrink-0">
            <Terminal className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Terminal</span>
          </div>
          <div className="flex-1 min-h-0">
            <TerminalPane ref={termRef} tabId="setup-mcp" />
          </div>
        </div>
      </div>
    </SetupLayout>
  );
}
