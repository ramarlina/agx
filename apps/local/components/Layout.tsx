"use client";

import Link from "next/link";
import { Suspense } from "react";
import DbStatus from "./db-status";

function LayoutContent({
  children,
  fullWidth = false,
  noFooter = false
}: {
  children: React.ReactNode;
  fullWidth?: boolean;
  noFooter?: boolean;
}) {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Navigation */}
      <nav className="desktop-titlebar flex-shrink-0 border-b border-[var(--card-border)] bg-[var(--card-bg)]/80 backdrop-blur-lg z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              {/* Logo */}
              <Link
                href="/"
                className="flex items-center gap-3 group"
              >
                <img src="/logo_light.png" alt="AGX" className="dark:hidden transition-transform group-hover:scale-105" style={{ height: 31, width: "auto" }} />
                <img src="/logo_dark.png" alt="AGX" className="hidden dark:block transition-transform group-hover:scale-105" style={{ height: 31, width: "auto" }} />
              </Link>
            </div>

            {/* Top-right actions (always visible) */}
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                Open Chat
              </Link>
              <Link
                href="/automations"
                className="text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                Automations
              </Link>
              <Link
                href="/skills"
                className="text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                Skills
              </Link>
              <Link
                href="/settings"
                className="text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                Settings
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className={`flex-1 min-h-0 flex flex-col ${fullWidth ? "p-0" : "p-4 sm:p-6 lg:p-8 overflow-y-auto"}`}>
        {children}
      </main>

      {/* Footer */}
      {!noFooter && (
        <footer className="flex-shrink-0 border-t border-[var(--card-border)] bg-[var(--card-bg)]/50 py-4">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>AGX Board • Autonomous Agent Orchestration</span>
            <span className="hidden sm:inline-flex items-center gap-3">
              <DbStatus />
              <span>Built with Next.js + Db</span>
            </span>
          </div>
        </footer>
      )}
    </div>
  );
}

export default function Layout(props: {
  children: React.ReactNode;
  fullWidth?: boolean;
  noFooter?: boolean;
}) {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-[var(--background)]">
        <span className="spinner w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full" />
      </div>
    }>
      <LayoutContent {...props} />
    </Suspense>
  );
}
