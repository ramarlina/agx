"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type OverallStatus = "ok" | "degraded" | "unknown";

interface ServiceInfo {
  name: string;
  status: "ok" | "error" | "unavailable";
  detail?: string;
}

export function StatusIndicator() {
  const [status, setStatus] = useState<OverallStatus>("unknown");
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [lastCheck, setLastCheck] = useState<string>("");
  const [showTooltip, setShowTooltip] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) {
        setStatus("unknown");
        return;
      }
      const data = await res.json();
      setStatus(data.status === "ok" ? "ok" : "degraded");
      // Only track critical services for the dot
      const critical = (data.services as ServiceInfo[]).filter(
        (s) => s.name === "agx-chat" || s.name === "agx-cloud"
      );
      setServices(critical);
      setLastCheck(new Date().toLocaleTimeString());
    } catch {
      setStatus("unknown");
      setServices([]);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const dotColor =
    status === "ok"
      ? "bg-emerald-400"
      : status === "degraded"
        ? "bg-amber-400"
        : "bg-[var(--app-shell-muted)]";

  const pulseColor =
    status === "degraded" ? "animate-pulse" : "";

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <Link
        href="/status"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] transition-all hover:bg-[var(--app-shell-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        title="System status"
      >
        <span className={`h-2.5 w-2.5 rounded-full ${dotColor} ${pulseColor}`} />
      </Link>

      {showTooltip && (
        <div className="absolute top-full right-0 z-50 mt-1.5 w-52 rounded-lg border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] p-3 text-xs shadow-lg">
          {services.length > 0 ? (
            <ul className="space-y-1.5">
              {services.map((s) => (
                <li key={s.name} className="flex items-center justify-between">
                  <span className="font-medium text-[var(--foreground)]">{s.name}</span>
                  <span
                    className={
                      s.status === "ok"
                        ? "text-emerald-600"
                        : s.status === "error"
                          ? "text-red-500"
                          : "text-[var(--muted-foreground)]"
                    }
                  >
                    {s.status === "ok" ? "Healthy" : s.status === "error" ? s.detail || "Error" : "Unavailable"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[var(--app-shell-soft-text)]">Checking...</p>
          )}
          {lastCheck && (
            <p className="mt-2 border-t border-[var(--app-shell-border)] pt-1.5 text-[var(--app-shell-soft-text)]">
              Last check: {lastCheck}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
