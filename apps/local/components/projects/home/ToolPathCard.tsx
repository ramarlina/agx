"use client";

import type { ReactNode } from "react";

interface ToolPathCardProps {
  icon: ReactNode;
  title: string;
  accentClass: string;
  onClick: () => void;
  badge?: ReactNode;
  children?: ReactNode;
}

export function ToolPathCard({ icon, title, accentClass, onClick, badge, children }: ToolPathCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:bg-zinc-800/50"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={accentClass}>{icon}</span>
          <span className="text-sm font-medium text-zinc-200">{title}</span>
        </div>
        {badge}
      </div>
      {children && <div className="text-sm">{children}</div>}
    </button>
  );
}
