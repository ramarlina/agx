"use client";

import { useEffect, useRef } from "react";
import type { ActivityItem } from "@/hooks/useActivityStream";
import { agentAvatarUrl } from "@/components/chat-ui/ParticipantBar";

const SOURCE_COLORS: Record<string, string> = {
  Chat: "bg-blue-500/15 text-blue-400",
  "Scheduled Task": "bg-amber-500/15 text-amber-400",
  Automation: "bg-purple-500/15 text-purple-400",
  Daemon: "bg-zinc-500/15 text-zinc-400",
};

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

function StatusDot({ status }: { status: string }) {
  if (status === "running")
    return <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />;
  if (status === "queued")
    return <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />;
  if (status === "failed")
    return <span className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 shrink-0" />;
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 hover:bg-[var(--app-shell-subtle)] transition-colors rounded-md">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={agentAvatarUrl(item.agentId ?? item.id, 20, item.agentColor)}
        alt=""
        className="h-5 w-5 rounded-full shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <StatusDot status={item.status} />
          <span className="text-xs font-medium text-[var(--foreground)] truncate">
            {item.agentName}
          </span>
        </div>
        <p className="text-[10px] text-[var(--muted-foreground)] truncate mt-0.5">
          {item.title}
        </p>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${SOURCE_COLORS[item.source] ?? SOURCE_COLORS.Daemon}`}>
          {item.source}
        </span>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          {formatRelativeTime(item.startedAt)}
        </span>
      </div>
    </div>
  );
}

export function ActivityStreamPopover({
  items,
  onClose,
}: {
  items: ActivityItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const id = setTimeout(
      () => document.addEventListener("pointerdown", handle),
      0
    );
    return () => {
      clearTimeout(id);
      document.removeEventListener("pointerdown", handle);
    };
  }, [onClose]);

  const active = items.filter(
    (i) => i.status === "running" || i.status === "queued"
  );
  const recent = items.filter(
    (i) => i.status !== "running" && i.status !== "queued"
  );

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 z-50 mt-1.5 w-80 max-h-96 overflow-y-auto rounded-xl border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] shadow-lg"
    >
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 px-4">
          <span className="text-xs text-[var(--muted-foreground)]">
            No recent activity
          </span>
        </div>
      ) : (
        <div className="py-1.5">
          {active.length > 0 && (
            <div>
              <div className="px-3 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Active Now
                </span>
              </div>
              {active.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </div>
          )}
          {recent.length > 0 && (
            <div>
              {active.length > 0 && (
                <div className="mx-3 my-1 border-t border-[var(--app-shell-border)]" />
              )}
              <div className="px-3 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Recent
                </span>
              </div>
              {recent.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
