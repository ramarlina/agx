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
      className="w-full rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 text-left transition-colors hover:bg-[var(--secondary)]"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={accentClass}>{icon}</span>
          <span className="text-sm font-medium text-[var(--foreground)]">{title}</span>
        </div>
        {badge}
      </div>
      {children && <div className="text-sm">{children}</div>}
    </button>
  );
}
