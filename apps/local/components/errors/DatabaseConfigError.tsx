"use client";

import { type StartupError, type StartupErrorKind, MIN_SQLITE_VERSION } from "@/lib/startup";

interface DatabaseConfigErrorProps {
  errors: StartupError[];
}

const ICONS: Record<StartupErrorKind, string> = {
  version_mismatch: "⚠",
  missing_extension: "🧩",
  filesystem_error: "💾",
  pragma_error: "⚙",
};

const TITLES: Record<StartupErrorKind, string> = {
  version_mismatch: "SQLite Version Mismatch",
  missing_extension: "Missing SQLite Extension",
  filesystem_error: "Unsupported Filesystem",
  pragma_error: "Configuration Error",
};

export default function DatabaseConfigError({ errors }: DatabaseConfigErrorProps) {
  if (errors.length === 0) return null;

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-[var(--background)] p-4"
      role="alert"
      aria-live="assertive"
    >
      <div className="max-w-xl w-full space-y-4">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            Database Configuration Error
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            AGX cannot start because {errors.length === 1 ? "a required check" : `${errors.length} required checks`} failed.
            Fix the {errors.length === 1 ? "issue" : "issues"} below and restart.
          </p>
        </div>

        {errors.map((error, i) => (
          <div
            key={i}
            className="border border-red-200 bg-red-50 rounded-lg p-4 space-y-2"
          >
            <div className="flex items-start gap-2">
              <span className="text-lg" aria-hidden="true">
                {ICONS[error.kind]}
              </span>
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-red-900 text-sm">
                  {TITLES[error.kind]}
                </h2>
                <p className="text-red-800 text-sm mt-0.5">{error.message}</p>

                {error.found && error.required && (
                  <div className="mt-2 text-xs text-red-700 font-mono flex gap-4">
                    <span>Found: <strong>{error.found}</strong></span>
                    <span>Required: <strong>{error.required}</strong></span>
                  </div>
                )}

                {error.path && (
                  <p className="mt-1 text-xs text-red-700 font-mono truncate">
                    Path: {error.path}
                  </p>
                )}

                {error.fix && (
                  <div className="mt-2 bg-red-100 rounded p-2">
                    <p className="text-xs text-red-800 font-medium mb-1">How to fix:</p>
                    <pre className="text-xs text-red-900 font-mono whitespace-pre-wrap select-all">
                      {error.fix}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        <div className="text-center pt-2">
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-dark)] transition-colors text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
