import { type Discussion } from "@/hooks/useThreadMention";
import { MessageSquare, Clock } from "lucide-react";

interface Props {
  isOpen: boolean;
  suggestions: Discussion[];
  activeIndex: number;
  listboxId: string;
  optionIdPrefix: string;
  onSelect: (discussion: Discussion) => void;
}

export function ThreadMentionPopover({
  isOpen,
  suggestions,
  activeIndex,
  listboxId,
  optionIdPrefix,
  onSelect,
}: Props) {
  if (!isOpen || suggestions.length === 0) return null;

  return (
    <div
      className="absolute bottom-full left-0 mb-2 w-80 bg-[var(--app-shell-elevated)] rounded-xl shadow-xl border border-[var(--app-shell-border)] overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100"
      role="listbox"
      id={listboxId}
    >
      <div className="px-3 py-2 bg-[var(--app-shell-subtle)] border-b border-[var(--app-shell-border)] text-[11px] font-bold text-[var(--app-shell-muted)] uppercase tracking-wider">
        Reference Discussion
      </div>
      <div className="max-h-64 overflow-y-auto p-1">
        {suggestions.map((discussion, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={discussion.rootMessageId}
              role="option"
              id={`${optionIdPrefix}-${index}`}
              aria-selected={isActive}
              onClick={() => onSelect(discussion)}
              className={`w-full text-left px-3 py-2.5 rounded-lg flex items-start gap-3 transition-colors ${
                isActive ? "bg-[var(--primary-muted)]" : "hover:bg-[var(--app-shell-subtle)]"
              }`}
            >
              <div className={`mt-0.5 p-1.5 rounded-md ${isActive ? "bg-[var(--primary-muted)] text-[var(--primary)]" : "bg-[var(--muted)] text-[var(--muted-foreground)]"}`}>
                <MessageSquare size={14} strokeWidth={2.5} />
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-semibold truncate ${isActive ? "text-[var(--primary)]" : "text-[var(--foreground)]"}`}>
                  {discussion.title}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-xs ${isActive ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"}`}>
                    {discussion.replies.length} replies
                  </span>
                  <span className="text-[var(--muted-foreground)]">•</span>
                  <span className="text-[10px] text-[var(--muted-foreground)] flex items-center gap-1">
                    <Clock size={10} />
                    {getTimeAgo(discussion.lastActivityAt)}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getTimeAgo(ts: number) {
  if (!ts) return "";
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(ts);
}