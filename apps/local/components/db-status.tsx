"use client";

import { useEffect, useState } from "react";
import { UI_POLL_DB_HEALTH_MS } from "@/lib/constants/timing";

interface HealthResponse {
  adapter: string;
  connected: boolean;
  latencyMs: number;
}

type Status = "loading" | "connected" | "disconnected" | "error";

export default function DbStatus() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let mounted = true;

    async function check() {
      try {
        const res = await fetch("/api/health");
        if (!mounted) return;
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const data: HealthResponse = await res.json();
        setHealth(data);
        setStatus(data.connected ? "connected" : "disconnected");
      } catch {
        if (mounted) setStatus("error");
      }
    }

    check();
    const interval = setInterval(check, UI_POLL_DB_HEALTH_MS);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const colors: Record<Status, string> = {
    loading: "bg-yellow-400",
    connected: "bg-green-500",
    disconnected: "bg-red-500",
    error: "bg-red-500",
  };

  const labels: Record<Status, string> = {
    loading: "Checking database…",
    connected: `${health?.adapter ?? "db"} connected (${health?.latencyMs ?? "?"}ms)`,
    disconnected: `${health?.adapter ?? "db"} disconnected`,
    error: "Database unreachable",
  };

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]"
      role="status"
      aria-label={labels[status]}
    >
      <span className={`w-2 h-2 rounded-full ${colors[status]}`} />
      <span className="hidden sm:inline">{labels[status]}</span>
    </span>
  );
}
