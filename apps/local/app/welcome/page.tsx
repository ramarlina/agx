"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChatPreview } from "@/components/chat-ui/ChatPreview";
import { updateUserPreferences } from "@/services/userPreferences";
import { PROVIDER_CLIS, type ProviderId } from "@/lib/provider-clis";
import {
  Check,
  Circle,
  Copy,
  ChevronDown,
  ExternalLink,
  Terminal,
  AlertCircle,
  Loader2,
} from "lucide-react";

interface CliInfo {
  id: ProviderId;
  name: string;
  description: string;
  installCmd: string;
  docsUrl: string;
  installNote?: string;
  recommended?: boolean;
  installed: boolean | null; // null = still checking
  authenticated: boolean | null;
  authCmd?: { cmd: string; description: string };
}

type ProviderStatus = "checking" | "not-installed" | "needs-auth" | "ready";

function deriveStatus(cli: CliInfo): ProviderStatus {
  if (cli.installed === null) return "checking";
  if (!cli.installed) return "not-installed";
  if (!cli.authenticated && cli.authCmd) return "needs-auth";
  return "ready";
}

const CLI_DEFS: Omit<CliInfo, "installed" | "authenticated">[] = PROVIDER_CLIS.map((provider) => ({
  id: provider.id,
  name: provider.label,
  description: provider.description,
  installCmd: provider.installCmd,
  docsUrl: provider.docsUrl,
  installNote: provider.installNote,
  recommended: provider.recommended,
  authCmd: provider.authCmd,
}));

type ReadyState = "checking" | "ready" | "needs-setup" | "error";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="p-1.5 rounded-md hover:bg-[var(--muted)] transition-colors text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      title="Copy command"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-500" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

function CliRow({
  cli,
  onVerify,
}: {
  cli: CliInfo;
  onVerify?: (id: ProviderId) => void;
}) {
  const status = deriveStatus(cli);
  const [expanded, setExpanded] = useState(status === "needs-auth");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const isExpandable = status === "not-installed" || status === "needs-auth";

  const handleVerify = useCallback(async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await fetch(`/api/providers/check/${cli.id}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setVerifyError("Check failed");
        return;
      }
      const data = await res.json();
      if (data.authenticated) {
        onVerify?.(cli.id);
      } else {
        setVerifyError("Not authenticated yet");
      }
    } catch {
      setVerifyError("Check failed");
    } finally {
      setVerifying(false);
    }
  }, [cli.id, onVerify]);

  return (
    <div className="border border-[var(--card-border)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => isExpandable && setExpanded(!expanded)}
        className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left ${
          isExpandable
            ? "hover:bg-[var(--item-hover-bg)] cursor-pointer"
            : "cursor-default"
        }`}
      >
        {/* Status indicator */}
        <div className="shrink-0">
          {status === "checking" ? (
            <Circle className="w-4 h-4 text-[var(--muted-foreground)] animate-pulse" />
          ) : status === "ready" ? (
            <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            </div>
          ) : status === "needs-auth" ? (
            <div className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Circle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            </div>
          ) : (
            <Circle className="w-4 h-4 text-[var(--muted-foreground)]" />
          )}
        </div>

        {/* Name + description */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-[var(--foreground)]">
              {cli.name}
            </span>
            {cli.recommended && status === "not-installed" && (
              <span className="text-[11px] font-medium text-[var(--foreground)] bg-[var(--secondary)] px-1.5 py-0.5 rounded">
                Recommended
              </span>
            )}
            {status === "ready" && (
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded">
                Ready
              </span>
            )}
            {status === "needs-auth" && (
              <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded">
                Needs auth
              </span>
            )}
          </div>
          <p className="text-[12px] text-[var(--muted-foreground)]">
            {cli.description}
          </p>
        </div>

        {/* Expand arrow */}
        {isExpandable && (
          <ChevronDown
            className={`w-4 h-4 text-[var(--muted-foreground)] transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        )}
      </button>

      {/* Expanded: install instructions (not installed) */}
      {expanded && status === "not-installed" && (
        <div className="px-4 pb-3 border-t border-[var(--card-border)]">
          <div className="mt-3 flex items-center gap-2 bg-[var(--secondary)] rounded-md px-3 py-2 font-mono text-[13px] text-[var(--foreground)]">
            <Terminal className="w-3.5 h-3.5 text-[var(--muted-foreground)] shrink-0" />
            <code className="flex-1 overflow-x-auto whitespace-nowrap">
              {cli.installCmd}
            </code>
            <CopyButton text={cli.installCmd} />
          </div>
          <a
            href={cli.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-[12px] text-[var(--primary)] hover:underline"
          >
            Documentation
            <ExternalLink className="w-3 h-3" />
          </a>
          {cli.installNote ? (
            <p className="mt-2 text-[12px] text-[var(--muted-foreground)]">
              {cli.installNote}
            </p>
          ) : null}
        </div>
      )}

      {/* Expanded: auth instructions (needs auth) */}
      {expanded && status === "needs-auth" && cli.authCmd && (
        <div className="px-4 pb-3 border-t border-[var(--card-border)]">
          <p className="mt-3 text-[12px] text-[var(--muted-foreground)]">
            {cli.authCmd.description}
          </p>
          <div className="mt-2 flex items-center gap-2 bg-[var(--secondary)] rounded-md px-3 py-2 font-mono text-[13px] text-[var(--foreground)]">
            <Terminal className="w-3.5 h-3.5 text-[var(--muted-foreground)] shrink-0" />
            <code className="flex-1 overflow-x-auto whitespace-nowrap">
              {cli.authCmd.cmd}
            </code>
            <CopyButton text={cli.authCmd.cmd} />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleVerify}
              disabled={verifying}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-colors disabled:opacity-60"
            >
              {verifying && (
                <Loader2 className="w-3 h-3 animate-spin" />
              )}
              {verifying ? "Checking..." : "Verify"}
            </button>
            {verifyError && (
              <span className="text-[12px] text-amber-600 dark:text-amber-400">
                {verifyError}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function WelcomePage() {
  const router = useRouter();
  const [readyState, setReadyState] = useState<ReadyState>("checking");
  const [clis, setClis] = useState<CliInfo[]>(
    CLI_DEFS.map((def) => ({ ...def, installed: null, authenticated: null }))
  );
  const [showSetup, setShowSetup] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/providers", { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setReadyState("error");
          return;
        }
        const data = await res.json();
        const providerList = Array.isArray(data?.providers)
          ? data.providers
          : [];

        const updatedClis = CLI_DEFS.map((def) => {
          const match = providerList.find(
            (p: { id?: string }) => p && p.id === def.id,
          );
          return {
            ...def,
            installed: match?.installed ?? false,
            authenticated: match?.authenticated ?? false,
          };
        });

        if (!cancelled) {
          setClis(updatedClis);
          const anyAuthenticated = updatedClis.some(
            (c) => deriveStatus(c) === "ready",
          );
          const anyInstalled = updatedClis.some((c) => c.installed);
          if (anyAuthenticated) {
            if (!cancelled) setReadyState("ready");
          } else if (anyInstalled) {
            if (!cancelled) {
              setReadyState("needs-setup");
              setShowSetup(true);
            }
          } else {
            if (!cancelled) {
              setReadyState("needs-setup");
              setShowSetup(true);
            }
          }
        }
      } catch {
        if (!cancelled) setReadyState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleJoin = useCallback(async () => {
    setLaunching(true);
    setLaunchError(null);
    try {
      await updateUserPreferences({ hasCompletedFirstRun: true });
      router.push("/");
    } catch (e) {
      console.error("Failed to finalize onboarding", e);
      setLaunchError(
        e instanceof Error
          ? e.message
          : "Could not complete setup. Try again."
      );
    } finally {
      setLaunching(false);
    }
  }, [router]);

  const handleVerifySuccess = useCallback((id: ProviderId) => {
    setClis((prev) => {
      const updated = prev.map((c) =>
        c.id === id ? { ...c, authenticated: true } : c,
      );
      const anyReady = updated.some((c) => deriveStatus(c) === "ready");
      if (anyReady) setReadyState("ready");
      return updated;
    });
  }, []);

  // Stable key: only re-run polling when the set of needs-auth providers changes
  const needsAuthIds = useMemo(
    () =>
      clis
        .filter((c) => deriveStatus(c) === "needs-auth")
        .map((c) => c.id),
    [clis],
  );
  const needsAuthKey = needsAuthIds.join(",");

  // Poll "needs-auth" providers every 5s using recursive setTimeout
  useEffect(() => {
    if (readyState === "checking" || needsAuthIds.length === 0) return;

    const controller = new AbortController();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    function pollProvider(id: ProviderId) {
      if (controller.signal.aborted) return;
      const timer = setTimeout(async () => {
        if (controller.signal.aborted) return;
        try {
          const res = await fetch(`/api/providers/check/${id}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          if (res.ok) {
            const data = await res.json();
            if (data.authenticated) {
              handleVerifySuccess(id);
              return; // stop polling this provider
            }
            if (!data.installed) {
              // Provider was uninstalled — update state, stop polling
              setClis((prev) =>
                prev.map((c) =>
                  c.id === id
                    ? { ...c, installed: false, authenticated: false }
                    : c,
                ),
              );
              return;
            }
          }
        } catch {
          if (controller.signal.aborted) return;
          // network error — continue polling
        }
        if (!controller.signal.aborted) pollProvider(id);
      }, 5000);
      timers.set(id, timer);
    }

    needsAuthIds.forEach(pollProvider);

    return () => {
      controller.abort();
      timers.forEach((t) => clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyState, needsAuthKey, handleVerifySuccess]);

  const authenticatedCount = clis.filter(
    (c) => deriveStatus(c) === "ready",
  ).length;
  const totalCount = clis.length;
  const recommendedCli =
    clis.find((cli) => cli.recommended) ?? clis[0] ?? null;
  const alternativeClis = clis.filter((cli) => !cli.recommended);

  return (
    <div className="h-screen w-full flex flex-col bg-[var(--secondary)]">
      {/* Identity line */}
      <div className="text-center pt-10 pb-2 px-4">
        <h1 className="text-[15px] font-medium text-[var(--app-shell-soft-text)] tracking-wide">
          Chat with a team of AI agents across Claude, Gemini, Codex, Ollama,
          and Z.AI
        </h1>
      </div>

      {/* Chat preview */}
      <ChatPreview />

      {/* CTA + status */}
      <div className="pb-8 pt-4 flex flex-col items-center gap-3 px-4">
        {readyState === "ready" && (
          <>
            <button
              type="button"
              onClick={handleJoin}
              disabled={launching}
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-[var(--foreground)] text-[var(--background)] text-[15px] font-semibold rounded-xl hover:opacity-90 transition-all duration-200 shadow-lg shadow-[var(--foreground)]/10 hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {launching ? "Starting AGX..." : "Launch AGX"}
            </button>
            <button
              type="button"
              onClick={() => setShowSetup((v) => !v)}
              className="text-[13px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors flex items-center gap-1"
            >
              <span className="text-emerald-600">
                {authenticatedCount}/{totalCount} providers ready
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${
                  showSetup ? "rotate-180" : ""
                }`}
              />
            </button>
          </>
        )}

        {readyState === "checking" && (
          <span className="text-[13px] text-[var(--app-shell-soft-text)]">
            Detecting installed providers...
          </span>
        )}

        {readyState === "needs-setup" && (
          <div className="text-center">
            {clis.some((c) => c.installed) ? (
              <>
                <p className="text-[14px] font-medium text-amber-600 dark:text-amber-400">
                  Authenticate a provider to continue
                </p>
                <p className="text-[13px] text-[var(--muted-foreground)] mt-1">
                  Run the auth command below, then click Verify
                </p>
              </>
            ) : (
              <>
                <p className="text-[14px] font-medium text-amber-600 dark:text-amber-400">
                  No providers found
                </p>
                <p className="text-[13px] text-[var(--muted-foreground)] mt-1">
                  Start with Claude Code, then come back to launch AGX
                </p>
              </>
            )}
          </div>
        )}

        {readyState === "error" && (
          <span className="text-[13px] text-[var(--app-shell-soft-text)]">
            Could not check installed providers
          </span>
        )}

        {launchError ? (
          <div className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {launchError}
          </div>
        ) : null}
      </div>

      {/* Setup panel */}
      {showSetup && (
        <div className="border-t border-[var(--card-border)] bg-[var(--background)] overflow-y-auto">
          <div className="max-w-lg mx-auto px-4 py-6">
            <div className="mb-4">
              <h2 className="text-[14px] font-semibold text-[var(--foreground)]">
                Provider CLIs
              </h2>
              <p className="mt-1 text-[12px] text-[var(--muted-foreground)]">
                Install and authenticate a provider to finish setup. Claude Code is the best first path.
              </p>
            </div>
            <div className="space-y-2">
              {recommendedCli ? (
                <div className="rounded-xl border border-[var(--card-border)] bg-[var(--secondary)] p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      Start Here
                    </span>
                    <span className="rounded bg-[var(--background)] px-2 py-0.5 text-[11px] font-medium text-[var(--foreground)]">
                      {recommendedCli.name}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] text-[var(--foreground)]">
                    Install Claude Code first if you want the shortest path into AGX.
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--muted-foreground)]">
                    Codex, Gemini CLI, Ollama, and Z.AI are available if they fit your stack better.
                  </p>
                </div>
              ) : null}
              {recommendedCli ? <CliRow key={recommendedCli.id} cli={recommendedCli} onVerify={handleVerifySuccess} /> : null}
            </div>
            {alternativeClis.length > 0 ? (
              <div className="mt-4">
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Other Options
                </h3>
                <div className="space-y-2">
                  {alternativeClis.map((cli) => (
                    <CliRow key={cli.id} cli={cli} onVerify={handleVerifySuccess} />
                  ))}
                </div>
              </div>
            ) : null}
            {readyState === "ready" ? (
              <p className="text-[12px] text-[var(--muted-foreground)] mt-4 text-center">
                Setup is complete. Launch AGX when you&apos;re ready.
              </p>
            ) : null}
            {readyState === "needs-setup" ? (
              <p className="text-[12px] text-[var(--muted-foreground)] mt-4 text-center">
                After installing a CLI, restart AGX so it can detect the new provider.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
