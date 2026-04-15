"use client";

import Link from "next/link";

export function EmptyStateCard({
  icon,
  title,
  description,
  ctaLabel,
  ctaHref,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <div className="h-full w-full flex items-center justify-center bg-[var(--background)] px-6 py-12">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-[var(--secondary)] flex items-center justify-center">
          {icon}
        </div>
        <div className="space-y-2">
          <h1 className="text-[22px] font-bold text-[var(--foreground)] tracking-tight">{title}</h1>
          <p className="text-[14px] text-[var(--muted-foreground)] leading-relaxed">{description}</p>
        </div>
        <Link
          href={ctaHref}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-[var(--foreground)] text-[var(--background)] text-[14px] font-semibold rounded-lg hover:opacity-90 transition-all"
        >
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}
