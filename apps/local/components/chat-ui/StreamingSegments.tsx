"use client";

import { useState } from "react";
import { Markdown } from "./Markdown";
import { parseStreamSegments } from "@/lib/chat-utils";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

interface Props {
  content: string;
}

export function StreamingSegments({ content }: Props) {
  const segments = parseStreamSegments(content);

  return (
    <div className="space-y-2">
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          <div key={i} className="surface-card rounded-2xl p-5 text-[15px] leading-relaxed">
            <Markdown content={seg.content} isUser={false} />
          </div>
        ) : (
          <ToolIndicator key={i} name={seg.name} details={seg.details} pending={seg.pending} />
        )
      )}
    </div>
  );
}

function ToolIndicator({ name, details, pending }: { name: string; details: string; pending: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="text-xs text-[var(--muted-foreground)] font-medium pl-2">
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
      {open && details && (
        <div className="ml-4 pl-3 border-l border-[var(--app-shell-border)] py-1 text-[var(--muted-foreground)] whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
          {details}
        </div>
      )}
    </div>
  );
}
