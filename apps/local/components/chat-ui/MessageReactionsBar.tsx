"use client";

import type { MessageReaction } from "@/lib/types";
import { ReactionChip } from "./ReactionChip";

interface Props {
  reactions?: MessageReaction[];
}

export function MessageReactionsBar({ reactions }: Props) {
  if (!reactions || reactions.length === 0) return null;

  const sorted = [...reactions].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.type.localeCompare(b.type);
  });

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {sorted.map((reaction) => (
        <ReactionChip
          key={reaction.type}
          type={reaction.type}
          count={reaction.count}
          participantIds={reaction.participantIds}
        />
      ))}
    </div>
  );
}
