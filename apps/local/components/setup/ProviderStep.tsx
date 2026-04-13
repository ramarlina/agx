// components/setup/ProviderStep.tsx
"use client";

import { useState, useCallback } from "react";
import {
  Check, Circle, Copy, ChevronDown, ExternalLink, Terminal, Loader2,
} from "lucide-react";
import type { CliStatus } from "@/hooks/useProviderStatus";
import { deriveStatus } from "@/hooks/useProviderStatus";
import type { ProviderId } from "@/lib/provider-clis";
import { SetupLayout } from "./SetupLayout";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button type="button" onClick={handleCopy} className="p-1.5 rounded-md hover:bg-[var(--muted)] transition-colors text-[var(--muted-foreground)] hover:text-[var(--foreground)]" title="Copy command">
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function CliRow({ cli, onVerify }: { cli: CliStatus; onVerify?: (id: ProviderId) => void }) {
  const status = deriveStatus(cli);
  const [expanded, setExpanded] = useState(status === "needs-auth");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const isExpandable = status === "not-installed" || status === "needs-auth";

  const handleVerify = useCallback(async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await fetch(`/api/providers/check/${cli.id}`, { cache: "no-store" });
      if (!res.ok) { setVerifyError("Check failed"); return; }
      const data = await res.json();
      if (data.authenticated) { onVerify?.(cli.id); } else { setVerifyError("Not authenticated yet"); }
    } catch { setVerifyError("Check failed"); }
    finally { setVerifying(false); }
  }, [cli.id, onVerify]);

  return (
    <div className="border border-[var(--card-border)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => isExpandable && setExpanded(!expanded)}
        className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left ${isExpandable ? "hover:bg-[var(--item-hover-bg)] cursor-pointer" : "cursor-default"}`}
      >
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
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-[var(--foreground)]">{cli.name}</span>
            {cli.recommended && status === "not-installed" && (
              <span className="text-[11px] font-medium text-[var(--foreground)] bg-[var(--secondary)] px-1.5 py-0.5 rounded">Recommended</span>
            )}
            {status === "ready" && (
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded">Ready</span>
            )}
            {status === "needs-auth" && (
              <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded">Needs auth</span>
            )}
          </div>
          <p className="text-[12px] text-[var(--muted-foreground)]">{cli.description}</p>
        </div>
        {isExpandable && (
          <ChevronDown className={`w-4 h-4 text-[var(--muted-foreground)] transition-transform ${expanded ? "rotate-180" : ""}`} />
        )}
      </button>

      {expanded && status === "not-installed" && (
        <div className="px-4 pb-3 border-t border-[var(--card-border)]">
          <div className="mt-3 flex items-center gap-2 bg-[var(--secondary)] rounded-md px-3 py-2 font-mono text-[13px] text-[var(--foreground)]">
            <Terminal className="w-3.5 h-3.5 text-[var(--muted-foreground)] shrink-0" />
            <code className="flex-1 overflow-x-auto whitespace-nowrap">{cli.installCmd}</code>
            <CopyButton text={cli.installCmd} />
          </div>
          <a href={cli.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-2 text-[12px] text-[var(--primary)] hover:underline">
            Documentation <ExternalLink className="w-3 h-3" />
          </a>
          {cli.installNote && <p className="mt-2 text-[12px] text-[var(--muted-foreground)]">{cli.installNote}</p>}
        </div>
      )}

      {expanded && status === "needs-auth" && cli.authCmd && (
        <div className="px-4 pb-3 border-t border-[var(--card-border)]">
          <p className="mt-3 text-[12px] text-[var(--muted-foreground)]">{cli.authCmd.description}</p>
          <div className="mt-2 flex items-center gap-2 bg-[var(--secondary)] rounded-md px-3 py-2 font-mono text-[13px] text-[var(--foreground)]">
            <Terminal className="w-3.5 h-3.5 text-[var(--muted-foreground)] shrink-0" />
            <code className="flex-1 overflow-x-auto whitespace-nowrap">{cli.authCmd.cmd}</code>
            <CopyButton text={cli.authCmd.cmd} />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={handleVerify} disabled={verifying} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-colors disabled:opacity-60">
              {verifying && <Loader2 className="w-3 h-3 animate-spin" />}
              {verifying ? "Checking..." : "Verify"}
            </button>
            {verifyError && <span className="text-[12px] text-amber-600 dark:text-amber-400">{verifyError}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

interface ProviderStepProps {
  clis: CliStatus[];
  readyState: "checking" | "ready" | "needs-setup" | "error";
  authenticatedCount: number;
  totalCount: number;
  onVerifySuccess: (id: ProviderId) => void;
  onNext: () => void;
}

export function ProviderStep({ clis, readyState, authenticatedCount, totalCount, onVerifySuccess, onNext }: ProviderStepProps) {
  const canProceed = readyState === "ready";
  const recommendedCli = clis.find((c) => c.recommended) ?? clis[0] ?? null;
  const alternativeClis = clis.filter((c) => !c.recommended);

  return (
    <SetupLayout
      currentStep={1}
      totalSteps={3}
      footer={
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-[var(--muted-foreground)]">
            <span className={canProceed ? "text-emerald-600 dark:text-emerald-400" : ""}>
              {authenticatedCount}/{totalCount} providers ready
            </span>
          </span>
          <button
            type="button"
            onClick={onNext}
            disabled={!canProceed}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-[var(--foreground)] text-[var(--background)] text-[14px] font-semibold rounded-lg hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      }
    >
      <div className="text-center mb-8">
        <h1 className="text-[24px] font-bold text-[var(--foreground)] tracking-tight">Connect a Provider</h1>
        <p className="mt-2 text-[14px] text-[var(--muted-foreground)] leading-relaxed">
          AGX orchestrates AI agents across multiple providers.<br />
          Connect at least one to get started.
        </p>
      </div>

      {readyState === "checking" && (
        <div className="text-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--muted-foreground)] mx-auto" />
          <p className="mt-3 text-[13px] text-[var(--muted-foreground)]">Detecting installed providers...</p>
        </div>
      )}

      {readyState === "error" && (
        <div className="text-center py-8">
          <p className="text-[14px] text-[var(--muted-foreground)]">Could not detect providers. Please reload.</p>
        </div>
      )}

      {(readyState === "needs-setup" || readyState === "ready") && (
        <div className="space-y-4">
          {!clis.some((c) => c.installed) && recommendedCli && (
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--secondary)] p-4 mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Start Here</span>
                <span className="rounded bg-[var(--background)] px-2 py-0.5 text-[11px] font-medium text-[var(--foreground)]">{recommendedCli.name}</span>
              </div>
              <p className="mt-2 text-[13px] text-[var(--foreground)]">Install Claude Code first if you want the shortest path into AGX.</p>
            </div>
          )}

          <div className="space-y-2">
            {recommendedCli && <CliRow cli={recommendedCli} onVerify={onVerifySuccess} />}
          </div>

          {alternativeClis.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Other Options</h3>
              <div className="space-y-2">
                {alternativeClis.map((cli) => <CliRow key={cli.id} cli={cli} onVerify={onVerifySuccess} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </SetupLayout>
  );
}
