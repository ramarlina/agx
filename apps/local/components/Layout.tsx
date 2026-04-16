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
                <svg
                  width="52"
                  height="31"
                  viewBox="0 0 64 38"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="transition-transform group-hover:scale-105"
                >
                  <rect width="64" height="38" rx="8" fill="black" />
                  <g stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M 14 27 C 17 16 19 10 20 8 C 21 12 23 20 25 27" />
                    <path d="M 16 20 C 19 19 21 21 23 20" />
                    <path d="M 40 13 C 35 10 30 13 30 19 C 30 25 34 28 38 27 C 40 26 40 22 40 20 L 36 20" />
                    <path d="M 46 11 C 48 16 51 22 54 27" />
                    <path d="M 54 11 C 52 16 49 22 46 27" />
                  </g>
                </svg>
              </Link>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                Home
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
            <span>AGX</span>
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
