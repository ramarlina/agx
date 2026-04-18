"use client";

import { ChevronDown } from "lucide-react";

interface Props {
    visible: boolean;
    onClick: () => void;
    label?: string;
}

export function JumpToLatestButton({ visible, onClick, label = "Jump to latest" }: Props) {
    if (!visible) return null;
    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
            <button
                type="button"
                onClick={onClick}
                className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--app-shell-border)] bg-[var(--app-shell-surface)] text-[var(--foreground)] text-xs font-medium shadow-md hover:bg-[var(--app-shell-elevated)] transition-colors animate-in fade-in slide-in-from-bottom-1 duration-200"
            >
                <ChevronDown className="w-3.5 h-3.5" />
                {label}
            </button>
        </div>
    );
}
