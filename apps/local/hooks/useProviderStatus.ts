// hooks/useProviderStatus.ts
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { PROVIDER_CLIS, type ProviderId } from "@/lib/provider-clis";

export type ProviderReadyState = "checking" | "ready" | "needs-setup" | "error";
export type ProviderStatus = "checking" | "not-installed" | "needs-auth" | "ready";

export interface CliStatus {
  id: ProviderId;
  name: string;
  description: string;
  installCmd: string;
  docsUrl: string;
  installNote?: string;
  recommended?: boolean;
  installed: boolean | null;
  authenticated: boolean | null;
  authCmd?: { cmd: string; description: string };
}

export function deriveStatus(cli: CliStatus): ProviderStatus {
  if (cli.installed === null) return "checking";
  if (!cli.installed) return "not-installed";
  if (!cli.authenticated && cli.authCmd) return "needs-auth";
  return "ready";
}

const CLI_DEFS: Omit<CliStatus, "installed" | "authenticated">[] = PROVIDER_CLIS.map((p) => ({
  id: p.id,
  name: p.label,
  description: p.description,
  installCmd: p.installCmd,
  docsUrl: p.docsUrl,
  installNote: p.installNote,
  recommended: p.recommended,
  authCmd: p.authCmd,
}));

export function useProviderStatus() {
  const [readyState, setReadyState] = useState<ProviderReadyState>("checking");
  const [clis, setClis] = useState<CliStatus[]>(
    CLI_DEFS.map((def) => ({ ...def, installed: null, authenticated: null }))
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/providers", { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) { setReadyState("error"); return; }
        const data = await res.json();
        const providerList = Array.isArray(data?.providers) ? data.providers : [];

        const updated = CLI_DEFS.map((def) => {
          const match = providerList.find((p: { id?: string }) => p?.id === def.id);
          return { ...def, installed: match?.installed ?? false, authenticated: match?.authenticated ?? false };
        });

        if (!cancelled) {
          setClis(updated);
          setReadyState(updated.some((c) => deriveStatus(c) === "ready") ? "ready" : "needs-setup");
        }
      } catch {
        if (!cancelled) setReadyState("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleVerifySuccess = useCallback((id: ProviderId) => {
    setClis((prev) => {
      const updated = prev.map((c) => c.id === id ? { ...c, authenticated: true } : c);
      if (updated.some((c) => deriveStatus(c) === "ready")) setReadyState("ready");
      return updated;
    });
  }, []);

  const needsAuthIds = useMemo(
    () => clis.filter((c) => deriveStatus(c) === "needs-auth").map((c) => c.id),
    [clis]
  );
  const needsAuthKey = needsAuthIds.join(",");

  useEffect(() => {
    if (readyState === "checking" || needsAuthIds.length === 0) return;
    const controller = new AbortController();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    function pollProvider(id: ProviderId) {
      if (controller.signal.aborted) return;
      const timer = setTimeout(async () => {
        if (controller.signal.aborted) return;
        try {
          const res = await fetch(`/api/providers/check/${id}`, { cache: "no-store", signal: controller.signal });
          if (controller.signal.aborted) return;
          if (res.ok) {
            const data = await res.json();
            if (data.authenticated) { handleVerifySuccess(id); return; }
            if (!data.installed) {
              setClis((prev) => prev.map((c) => c.id === id ? { ...c, installed: false, authenticated: false } : c));
              return;
            }
          }
        } catch { if (controller.signal.aborted) return; }
        if (!controller.signal.aborted) pollProvider(id);
      }, 5000);
      timers.set(id, timer);
    }

    needsAuthIds.forEach(pollProvider);
    return () => { controller.abort(); timers.forEach((t) => clearTimeout(t)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyState, needsAuthKey, handleVerifySuccess]);

  const authenticatedCount = clis.filter((c) => deriveStatus(c) === "ready").length;

  return { readyState, clis, authenticatedCount, totalCount: clis.length, handleVerifySuccess };
}
