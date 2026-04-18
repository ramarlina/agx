"use client";

import { useCallback, useState } from "react";
import { Activity } from "lucide-react";
import type { Participant } from "@/lib/types";
import { useActivityStream } from "@/hooks/useActivityStream";
import { useInputCapabilities } from "@/hooks/useInputCapabilities";
import { ActivityStreamPopover } from "./ActivityStreamPopover";

export function ActivityStreamButton({
  projectId,
  participants,
}: {
  projectId: string;
  participants: Participant[];
}) {
  const { isTouchLayout } = useInputCapabilities();
  const { items, activeCount } = useActivityStream(projectId, participants);
  const [open, setOpen] = useState(false);

  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] hover:bg-[var(--app-shell-subtle)] ${isTouchLayout ? "h-9 w-9" : "h-7 w-7"}`}
        title="Activity stream"
        aria-label="Activity stream"
      >
        <Activity className={isTouchLayout ? "h-4 w-4" : "h-3.5 w-3.5"} />
        {activeCount > 0 && (
          <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
        )}
      </button>
      {open && <ActivityStreamPopover items={items} onClose={handleClose} />}
    </div>
  );
}
