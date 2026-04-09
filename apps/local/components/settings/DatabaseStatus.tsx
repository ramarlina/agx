"use client";

import { useEffect, useState } from "react";

type StatusLevel = "pass" | "fail" | "warn";

interface Check {
  label: string;
  value: string;
  status: StatusLevel;
}

interface DbStatus {
  version: string;
  checks: Check[];
  backup: {
    lastBackup: string | null;
    walSizeBytes: number | null;
  };
}

const STATUS_ICONS: Record<StatusLevel, { icon: string; color: string; label: string }> = {
  pass: { icon: "\u2713", color: "text-green-600", label: "Pass" },
  fail: { icon: "\u2717", color: "text-red-600", label: "Fail" },
  warn: { icon: "!", color: "text-yellow-600", label: "Warning" },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DatabaseStatus() {
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/system/db-status");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        if (!cancelled) setStatus(data);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load database status");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const hasFailures = status?.checks.some((c) => c.status === "fail");

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">SQLite Environment</h2>
        {status && (
          <span
            className={`text-xs font-medium px-2 py-1 rounded-full ${
              hasFailures
                ? "bg-red-100 text-red-700"
                : "bg-green-100 text-green-700"
            }`}
            role="status"
            aria-label={hasFailures ? "Configuration issues detected" : "All checks passed"}
          >
            {hasFailures ? "Issues Detected" : "Healthy"}
          </span>
        )}
      </div>

      {loading && (
        <div className="text-sm text-[var(--muted-foreground)]" role="status" aria-live="polite">
          Loading database status...
        </div>
      )}

      {error && (
        <div
          className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm"
          role="alert"
        >
          {error}
        </div>
      )}

      {status && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table" aria-label="SQLite configuration checks">
              <thead>
                <tr className="border-b border-[var(--card-border)]">
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-[var(--muted-foreground)]" scope="col">
                    Check
                  </th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-[var(--muted-foreground)]" scope="col">
                    Value
                  </th>
                  <th className="text-center py-2 text-xs font-semibold text-[var(--muted-foreground)]" scope="col">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {status.checks.map((check) => {
                  const si = STATUS_ICONS[check.status];
                  return (
                    <tr key={check.label} className="border-b border-[var(--card-border)] last:border-0">
                      <td className="py-2 pr-4 font-medium">{check.label}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{check.value}</td>
                      <td className="py-2 text-center">
                        <span
                          className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-sm font-bold ${si.color}`}
                          role="img"
                          aria-label={`${check.label}: ${si.label}`}
                        >
                          {si.icon}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 pt-4 border-t border-[var(--card-border)]">
            <h3 className="text-xs font-semibold text-[var(--muted-foreground)] mb-2">
              Backup Status
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-[var(--muted-foreground)]">Last backup: </span>
                <span className="font-mono text-xs">
                  {status.backup.lastBackup
                    ? new Date(status.backup.lastBackup).toLocaleString()
                    : "None"}
                </span>
              </div>
              <div>
                <span className="text-[var(--muted-foreground)]">WAL size: </span>
                <span className="font-mono text-xs">
                  {status.backup.walSizeBytes != null
                    ? formatBytes(status.backup.walSizeBytes)
                    : "N/A"}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
