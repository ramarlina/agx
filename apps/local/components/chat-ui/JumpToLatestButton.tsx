"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

interface Props {
    visible: boolean;
    onClick: () => void;
    direction?: "top" | "bottom";
    label?: string;
}

export function JumpToLatestButton({ visible, onClick, direction = "bottom", label }: Props) {
    if (!visible) return null;
    const Icon = direction === "top" ? ChevronUp : ChevronDown;
    const resolvedLabel = label ?? (direction === "top" ? "Back to top" : "Jump to latest");
    return (
        <div className={`pointer-events-none absolute inset-x-0 ${direction === "top" ? "top-3" : "bottom-3"} z-10 flex justify-center`}>
            <button
                type="button"
                onClick={onClick}
                className={`pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--app-shell-border)] bg-[var(--app-shell-surface)] text-[var(--foreground)] text-xs font-medium shadow-md hover:bg-[var(--app-shell-elevated)] transition-colors animate-in fade-in ${direction === "top" ? "slide-in-from-top-1" : "slide-in-from-bottom-1"} duration-200`}
            >
                <Icon className="w-3.5 h-3.5" />
                {resolvedLabel}
            </button>
        </div>
    );
}
