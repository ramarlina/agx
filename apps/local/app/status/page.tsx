"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { RefreshCw, ArrowLeft, Circle, AlertTriangle, XCircle } from "lucide-react";

interface ServiceStatus {
  name: string;
  status: "ok" | "error" | "unavailable";
  latencyMs?: number;
  detail?: string;
}

interface StatusResponse {
  status: "ok" | "degraded";
  services: ServiceStatus[];
  limits?: { maxWorkers: number; writeQpsCeiling: number };
  timestamp: string;
}

const statusIcon = (status: ServiceStatus["status"]) => {
  switch (status) {
    case "ok":
      return <Circle className="w-3 h-3 fill-emerald-400 text-emerald-400" />;
    case "error":
      return <XCircle className="w-3 h-3 text-red-400" />;
    case "unavailable":
      return <AlertTriangle className="w-3 h-3 text-[var(--muted-foreground)]" />;
  }
};

const statusLabel = (status: ServiceStatus["status"]) => {
  switch (status) {
    case "ok":
      return <span className="text-emerald-400 text-xs font-medium">OK</span>;
    case "error":
      return <span className="text-red-400 text-xs font-medium">Error</span>;
    case "unavailable":
      return <span className="text-[var(--muted-foreground)] text-xs font-medium">Unavailable</span>;
  }
};

export default function StatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  const coreServices = data?.services.filter((s) => !s.name.startsWith("cli:")) ?? [];
  const cliProviders = data?.services.filter((s) => s.name.startsWith("cli:")) ?? [];

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-lg font-semibold">System Status</h1>
            {data && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  data.status === "ok"
                    ? "bg-emerald-400/10 text-emerald-400"
                    : "bg-amber-400/10 text-amber-400"
                }`}
              >
                {data.status === "ok" ? "All systems operational" : "Degraded"}
              </span>
            )}
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-red-400/10 border border-red-400/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Core Services */}
        <section className="mb-8">
          <h2 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
            Services
          </h2>
          <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
            {coreServices.map((s) => (
              <div key={s.name} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  {statusIcon(s.status)}
                  <span className="text-sm font-medium">{s.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  {s.latencyMs !== undefined && (
                    <span className="text-xs text-[var(--muted-foreground)]">{s.latencyMs}ms</span>
                  )}
                  {statusLabel(s.status)}
                </div>
              </div>
            ))}
            {coreServices.length === 0 && !loading && (
              <div className="px-4 py-3 text-sm text-[var(--muted-foreground)]">No services found</div>
            )}
          </div>
        </section>

        {/* CLI Providers */}
        <section className="mb-8">
          <h2 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
            CLI Providers
          </h2>
          <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
            {cliProviders.map((s) => (
              <div key={s.name} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  {statusIcon(s.status)}
                  <span className="text-sm font-medium">{s.name.replace("cli:", "")}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--muted-foreground)]">{s.detail}</span>
                  {statusLabel(s.status)}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Operational Limits */}
        {data?.limits && (
          <section className="mb-8">
            <h2 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
              Operational Limits
            </h2>
            <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <Circle className="w-3 h-3 fill-[var(--muted-foreground)] text-[var(--muted-foreground)]" />
                  <span className="text-sm font-medium">Max Workers</span>
                </div>
                <span className="text-xs text-[var(--app-shell-soft-text)] font-mono">{data.limits.maxWorkers}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <Circle className="w-3 h-3 fill-[var(--muted-foreground)] text-[var(--muted-foreground)]" />
                  <span className="text-sm font-medium">Write QPS Ceiling</span>
                </div>
                <span className="text-xs text-[var(--app-shell-soft-text)] font-mono">{data.limits.writeQpsCeiling}</span>
              </div>
              <div className="px-4 py-2">
                <span className="text-[11px] text-[var(--muted-foreground)]">
                  Single-coordinator / single-writer SQLite architecture.{" "}
                  <a href="https://github.com/anthropics/agx-cloud/blob/main/docs/LIMITS.md" target="_blank" rel="noopener" className="underline hover:text-[var(--app-shell-soft-text)]">
                    See LIMITS.md
                  </a>
                </span>
              </div>
            </div>
          </section>
        )}

        {/* Timestamp */}
        {data && (
          <p className="text-xs text-[var(--muted-foreground)] text-center">
            Last checked: {new Date(data.timestamp).toLocaleTimeString()}
          </p>
        )}
      </div>
    </div>
  );
}
