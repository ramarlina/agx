"use client";

import type { ReactionType } from "@/lib/types";

const REACTION_META: Record<ReactionType, { symbol: string; label: string }> = {
  ack: { symbol: "👍", label: "Acknowledged" },
  working: { symbol: "🔄", label: "Working" },
  done: { symbol: "✅", label: "Done" },
  clarify: { symbol: "❓", label: "Needs clarification" },
  blocked: { symbol: "⛔", label: "Blocked" },
};

interface Props {
  type: ReactionType;
  count: number;
  participantIds: string[];
}

export function ReactionChip({ type, count, participantIds }: Props) {
  const meta = REACTION_META[type];
  const reactors = participantIds.join(", ");
  const title = reactors ? `${meta.label}: ${reactors}` : meta.label;

  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full border border-[var(--app-shell-border)] bg-[var(--app-shell-surface)] px-2 py-0.5 text-xs text-[var(--foreground)]"
    >
      <span aria-hidden>{meta.symbol}</span>
      <span className="tabular-nums">{count}</span>
    </span>
  );
}
