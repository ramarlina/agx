"use client";

import { useState } from "react";
import { Markdown } from "./Markdown";
import { parseStreamSegments } from "@/lib/chat-utils";
import { ChevronDown, ChevronRight, Loader2, Brain } from "lucide-react";

interface Props {
  content: string;
  thoughts?: string[];
}

export function StreamingSegments({ content, thoughts }: Props) {
  const segments = parseStreamSegments(content);

  return (
    <div className="space-y-1">
      {thoughts && thoughts.length > 0 && thoughts.map((thought, i) => (
        <ThinkingBlock key={`thought-${i}`} content={thought} />
      ))}
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          <div key={i} className="text-[15px] leading-relaxed">
            <Markdown content={seg.content} isUser={false} />
          </div>
        ) : (
          <ToolIndicator key={i} name={seg.name} input={seg.input} pending={seg.pending} />
        )
      )}
    </div>
  );
}

function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="text-xs text-[var(--muted-foreground)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 hover:text-[var(--foreground)] transition-colors py-1 font-medium"
      >
        {open ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <Brain className="w-3 h-3" />
        <span>Thinking</span>
      </button>
      {open && (
        <div className="ml-4 pl-3 border-l border-[var(--app-shell-border)] py-1 text-[var(--muted-foreground)] text-[13px] leading-relaxed">
          <Markdown content={content} isUser={false} />
        </div>
      )}
    </div>
  );
}

function ToolIndicator({ name, input, pending }: { name: string; input: string; pending: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="text-xs text-[var(--muted-foreground)] font-medium">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 hover:text-[var(--foreground)] transition-colors py-1"
      >
        {pending ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : open ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span>{name}</span>
        {pending && <span className="opacity-60">running...</span>}
      </button>
      {open && input && (
        <div className="ml-4 pl-3 border-l border-[var(--app-shell-border)] py-1 text-[var(--muted-foreground)] whitespace-pre-wrap break-all max-h-40 overflow-y-auto font-mono text-[11px]">
          {input}
        </div>
      )}
    </div>
  );
}
