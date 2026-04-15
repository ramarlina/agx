// components/setup/ProviderStep.tsx
"use client";

import { useState, useCallback, useRef } from "react";
import {
  Check, Circle, Copy, ChevronDown, Terminal, Loader2,
} from "lucide-react";
import type { CliStatus } from "@/hooks/useProviderStatus";
import { deriveStatus } from "@/hooks/useProviderStatus";
import type { ProviderId } from "@/lib/provider-clis";
import { SetupLayout } from "./SetupLayout";
import TerminalPane, { type TerminalPaneHandle } from "@/components/terminal/TerminalPane";

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

function CliRow({ cli, onVerify, onRunInTerminal }: {
  cli: CliStatus;
  onVerify?: (id: ProviderId) => void;
  onRunInTerminal?: (cmd: string) => void;
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
      const res = await fetch(`/api/providers/check/${cli.id}`, { cache: "no-store" });
      if (!res.ok) { setVerifyError("Check failed"); return; }
      const data = await res.json();
      if (data.authenticated) { onVerify?.(cli.id); } else { setVerifyError("Not authenticated yet"); }
    } catch { setVerifyError("Check failed"); }
    finally { setVerifying(false); }
  }, [cli.id, onVerify]);

  const runCmd = status === "not-installed" ? cli.installCmd : cli.authCmd?.cmd;

  return (
    <div className="border border-[var(--card-border)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => isExpandable && setExpanded(!expanded)}
        className={`w-full flex items-center gap-2.5 px-3 py-2 transition-colors text-left ${isExpandable ? "hover:bg-[var(--item-hover-bg)] cursor-pointer" : "cursor-default"}`}
      >
        <div className="shrink-0">
          {status === "checking" ? (
            <Circle className="w-3.5 h-3.5 text-[var(--muted-foreground)] animate-pulse" />
          ) : status === "ready" ? (
            <div className="w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Check className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
            </div>
          ) : status === "needs-auth" ? (
            <div className="w-4 h-4 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Circle className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400" />
            </div>
          ) : (
            <Circle className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
          )}
        </div>
        <span className="flex-1 min-w-0 text-[13px] font-semibold text-[var(--foreground)] truncate">{cli.name}</span>
        {status === "ready" && (
          <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">Ready</span>
        )}
        {status === "needs-auth" && (
          <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Needs auth</span>
        )}
        {status === "not-installed" && cli.recommended && (
          <span className="text-[10px] font-medium text-[var(--muted-foreground)]">Recommended</span>
        )}
        {isExpandable && (
          <ChevronDown className={`w-3.5 h-3.5 text-[var(--muted-foreground)] transition-transform ${expanded ? "rotate-180" : ""}`} />
        )}
      </button>

      {expanded && isExpandable && runCmd && (
        <div className="px-3 pb-2.5 pt-1 border-t border-[var(--card-border)] flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onRunInTerminal?.(runCmd)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-colors"
          >
            <Terminal className="w-3 h-3" />
            Run
          </button>
          {status === "needs-auth" && (
            <button
              type="button"
              onClick={handleVerify}
              disabled={verifying}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border border-[var(--card-border)] text-[var(--foreground)] hover:bg-[var(--secondary)] transition-colors disabled:opacity-60"
            >
              {verifying && <Loader2 className="w-3 h-3 animate-spin" />}
              {verifying ? "Checking" : "Verify"}
            </button>
          )}
          <CopyButton text={runCmd} />
          {verifyError && <span className="text-[10px] text-amber-600 dark:text-amber-400 ml-auto">{verifyError}</span>}
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
  const termRef = useRef<TerminalPaneHandle>(null);
  const runInTerminal = useCallback((cmd: string) => {
    termRef.current?.sendCommand(cmd);
  }, []);

  return (
    <SetupLayout
      currentStep={1}
      totalSteps={2}
      wide
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
      {/* Title — spans both columns */}
      <div className="text-center mb-8">
        <h1 className="text-[24px] font-bold text-[var(--foreground)] tracking-tight">Connect a Provider</h1>
        <p className="mt-2 text-[14px] text-[var(--muted-foreground)] leading-relaxed">
          AGX orchestrates AI agents across multiple providers.<br />
          Connect at least one to get started.
        </p>
      </div>

      <div className="flex gap-6 min-h-0 items-start">
        {/* Left column — provider list */}
        <div className="w-[280px] shrink-0">
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
            <div className="space-y-1.5">
              {clis.map((cli) => (
                <CliRow key={cli.id} cli={cli} onVerify={onVerifySuccess} onRunInTerminal={runInTerminal} />
              ))}
            </div>
          )}
        </div>

        {/* Right column — terminal (landscape) */}
        <div className="flex-1 min-w-0 h-[420px] flex flex-col rounded-xl border border-[var(--card-border)] overflow-hidden bg-[#1e1e1e]">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--card-border)] bg-[var(--secondary)] shrink-0">
            <Terminal className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Terminal</span>
          </div>
          <div className="flex-1 min-h-0">
            <TerminalPane ref={termRef} tabId="setup-provider" />
          </div>
        </div>
      </div>
    </SetupLayout>
  );
}
