"use client";

import React from "react";
import { CheckCircle2, Key, Globe, Loader2, AlertCircle, Terminal, LogOut } from "lucide-react";
import { TrackerIcon } from "./TrackerIcon";
import GithubRepoManager from "./GithubRepoManager";
import ConfirmDialog from "../ConfirmDialog";

interface TrackerSetupProps {
  trackerType: string;
  projectId: string;
  connected: boolean;
  onConnect: () => void;
  onConnectWithKey: (apiKey: string) => Promise<{ ok: boolean; error?: string }>;
  onDisconnect?: () => void;
  loading?: boolean;
  clis?: { claude: boolean; codex: boolean; gemini: boolean };
  mcpConfigured?: Record<string, boolean>;
  onConfigureMcp?: (cli: string) => Promise<{ ok: boolean; error?: string }>;
}

const CLI_LABELS: Record<string, { name: string; configPath: string }> = {
  claude: { name: "Claude Code", configPath: "~/.claude/settings.json" },
  codex: { name: "Codex CLI", configPath: "~/.codex/config.toml" },
  gemini: { name: "Gemini CLI", configPath: "~/.gemini/settings.json" },
};

/**
 * Tracker-agnostic setup/connect component.
 * Shows connection status and provides connect/disconnect actions.
 */
export default function TrackerSetup({
  trackerType,
  projectId,
  connected,
  onConnect,
  onConnectWithKey,
  onDisconnect,
  loading = false,
  clis,
  mcpConfigured,
  onConfigureMcp,
}: TrackerSetupProps) {
  const [apiKey, setApiKey] = React.useState("");
  const [keyError, setKeyError] = React.useState<string | null>(null);
  const [showKeyInput, setShowKeyInput] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [installingCli, setInstallingCli] = React.useState<string | null>(null);
  const [mcpErrors, setMcpErrors] = React.useState<Record<string, string>>({});
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);

  const installMcp = async (cli: string) => {
    if (!onConfigureMcp) return;
    setInstallingCli(cli);
    setMcpErrors((prev) => ({ ...prev, [cli]: "" }));
    const result = await onConfigureMcp(cli);
    if (!result.ok) {
      setMcpErrors((prev) => ({ ...prev, [cli]: result.error ?? "Failed to install MCP" }));
    }
    setInstallingCli(null);
  };

  const activeClis = clis
    ? (["claude", "codex", "gemini"] as const).filter((cli) => clis[cli])
    : (["claude"] as const);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="animate-spin h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (connected) {
    return (
      <div className="p-8 flex flex-col items-center gap-6">
        <div className="w-full max-w-md p-8 border border-green-500/20 bg-green-500/5 rounded-2xl flex flex-col items-center gap-4 text-center">
          <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center text-green-600 shadow-inner">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-foreground capitalize">{trackerType} Connected</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your {trackerType} tickets now live in AGX. Assign them to agents, review the work, and ship PRs from one window.
            </p>
          </div>
          <div className="mt-2 px-4 py-1.5 rounded-full bg-background border text-xs font-medium text-muted-foreground flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            Active Connection
          </div>
          {onDisconnect && (
            <button
              onClick={() => setConfirmDisconnect(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors mt-1"
            >
              <LogOut className="h-3.5 w-3.5" />
              Disconnect
            </button>
          )}
        </div>

        {trackerType === "github" && <GithubRepoManager projectId={projectId} />}

        {onDisconnect && (
          <ConfirmDialog
            isOpen={confirmDisconnect}
            title={`Disconnect ${trackerType}?`}
            message={
              trackerType === "github"
                ? "This revokes the stored credentials. Your attached repositories and synced history stay — reconnecting will resume where you left off."
                : `This revokes the stored credentials for ${trackerType}. Project settings and synced history stay.`
            }
            confirmLabel="Disconnect"
            cancelLabel="Cancel"
            variant="danger"
            onConfirm={() => {
              setConfirmDisconnect(false);
              onDisconnect();
            }}
            onCancel={() => setConfirmDisconnect(false)}
          />
        )}

        {trackerType !== "github" && activeClis.length > 0 && (
          <div className="w-full max-w-md">
            <div className="border rounded-xl p-5 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">MCP Server</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed -mt-2">
                Install the {trackerType} MCP server so agents can access {trackerType} directly.
              </p>
              {activeClis.map((cli) => {
                const label = CLI_LABELS[cli];
                const configured = mcpConfigured?.[cli] ?? false;
                const installing = installingCli === cli;
                const err = mcpErrors[cli];
                return (
                  <div key={cli} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-foreground">{label.name}</span>
                      {configured ? (
                        <span className="text-xs font-medium text-green-600 flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Installed
                        </span>
                      ) : (
                        <button
                          onClick={() => installMcp(cli)}
                          disabled={installing || !onConfigureMcp}
                          className="flex items-center gap-1.5 px-3 py-1 bg-secondary text-secondary-foreground rounded-md text-xs font-semibold hover:bg-secondary/90 disabled:opacity-50 transition-all active:scale-[0.98]"
                        >
                          {installing ? (
                            <><Loader2 className="h-3 w-3 animate-spin" />Installing…</>
                          ) : (
                            <>Install</>
                          )}
                        </button>
                      )}
                    </div>
                    {configured && (
                      <p className="text-[10px] text-muted-foreground">
                        Configured in <code className="font-mono">{label.configPath}</code>
                      </p>
                    )}
                    {err && (
                      <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 p-2 rounded-md">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        {err}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  const handleKeyConnect = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setKeyError(null);
    try {
      const result = await onConnectWithKey(apiKey.trim());
      if (!result.ok) {
        setKeyError(result.error ?? "Failed to connect");
      } else {
        setApiKey("");
        setShowKeyInput(false);
      }
    } catch (e) {
      setKeyError("An unexpected error occurred");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-6 p-8">
      <div className="relative">
        <TrackerIcon trackerType={trackerType} className="h-16 w-16" />
        <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-background border flex items-center justify-center shadow-sm">
          <Globe className="h-3 w-3 text-muted-foreground" />
        </div>
      </div>

      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold capitalize">Connect to {trackerType}</h3>
        <p className="text-sm text-muted-foreground text-center max-w-sm leading-relaxed">
          Link your {trackerType} account to import issues, track progress, and automate your workflow.
        </p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-xs pt-2">
        <button
          onClick={onConnect}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-all active:scale-[0.98] shadow-sm"
        >
          <Globe className="h-4 w-4" />
          Connect with OAuth
        </button>

        <button
          onClick={() => {
            setShowKeyInput(!showKeyInput);
            setKeyError(null);
          }}
          className="flex items-center justify-center gap-2 w-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          <Key className="h-3.5 w-3.5" />
          {showKeyInput
            ? "Use OAuth instead"
            : trackerType === "github"
              ? "Connect with Personal Access Token"
              : "Connect with API key"}
        </button>

        {/* Animated API Key Section */}
        <div className={`grid transition-all duration-300 ease-in-out ${showKeyInput ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
          <div className="overflow-hidden">
            <div className="flex flex-col gap-3 pt-2">
              <div className="relative">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    if (keyError) setKeyError(null);
                  }}
                  placeholder={
                    trackerType === "github"
                      ? "ghp_… or github_pat_…"
                      : "Paste your API key here"
                  }
                  className={`w-full px-3 py-2 border rounded-lg text-sm bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 ${keyError ? 'border-destructive' : 'focus:border-primary'}`}
                  onKeyDown={(e) => e.key === "Enter" && handleKeyConnect()}
                />
                <Key className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground/50" />
              </div>

              {keyError && (
                <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 p-2 rounded-md">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <p>{keyError}</p>
                </div>
              )}

              <button
                onClick={handleKeyConnect}
                disabled={saving || !apiKey.trim()}
                className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm font-semibold hover:bg-secondary/90 disabled:opacity-50 transition-all active:scale-[0.98]"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  "Verify & Connect"
                )}
              </button>

              <p className="text-[10px] text-muted-foreground text-center px-2">
                {trackerType === "github"
                  ? "Fine-grained PAT recommended. Needs repo access + read on issues/pull requests."
                  : `Your API key is stored securely and only used for ${trackerType} integration.`}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}