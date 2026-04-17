"use client";

import React, { useState, useMemo } from "react";
import { Play } from "lucide-react";
import type { Participant } from "@/lib/types";
import { agentAvatarUrl } from "@/lib/tracker-board-utils";

interface PromptPopoverProps {
  count: number;
  participants: Participant[];
  onSend: (prompt: string, agentId: string) => void;
}

export function PromptPopover({ count, participants, onSend }: PromptPopoverProps) {
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState(participants[0]?.id ?? "");
  const selectedAgent = useMemo(
    () => participants.find((p) => p.id === agentId) ?? participants[0],
    [participants, agentId]
  );

  return (
    <div className="flex w-80 flex-col gap-3 p-1">
      <textarea
        className="min-h-[80px] w-full resize-none rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--muted-foreground)]"
        placeholder="Enter prompt to send to all selected tickets..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        autoFocus
      />
      {participants.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
            Agent
          </span>
          <select
            className="flex-1 appearance-none rounded-md border border-[var(--card-border)] bg-[var(--background)] px-2 py-1 text-xs outline-none"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <button
        type="button"
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
        disabled={!prompt.trim()}
        onClick={() => {
          if (prompt.trim()) {
            onSend(prompt.trim(), agentId);
          }
        }}
      >
        <Play size={12} />
        Send to {count} ticket{count !== 1 ? "s" : ""}
      </button>
    </div>
  );
}
