"use client";

import { useEffect, useState, type ReactNode } from "react";
import DatabaseConfigError from "./DatabaseConfigError";
import type { StartupError, StartupErrorKind } from "@/lib/startup";

interface DbStatusResponse {
  version: string;
  checks: { label: string; value: string; status: "pass" | "fail" | "warn" }[];
  error?: string;
}

/** Maps db-status check labels to StartupErrorKind */
function mapCheckToError(check: { label: string; value: string }): StartupError {
  const kindMap: Record<string, StartupErrorKind> = {
    "SQLite Version": "version_mismatch",
    journal_mode: "pragma_error",
    foreign_keys: "pragma_error",
    busy_timeout: "pragma_error",
    synchronous: "pragma_error",
    cache_size: "pragma_error",
    "JSON1 Extension": "missing_extension",
    "FTS5 Extension": "missing_extension",
    Filesystem: "filesystem_error",
  };

  const kind = kindMap[check.label] || "pragma_error";

  const fixes: Record<string, string> = {
    "SQLite Version": "Ensure Node.js >= 22.16 is installed (node:sqlite requires it)",
    journal_mode: "Ensure the database is on a local filesystem with no exclusive locks",
    foreign_keys: "PRAGMA foreign_keys = ON",
    "JSON1 Extension": "Rebuild SQLite with JSON1 enabled, or use a system SQLite that includes it",
    Filesystem: "Move the database file to a local SSD. WAL mode requires reliable fsync.",
  };

  return {
    kind,
    message: `${check.label}: expected to pass, got '${check.value}'`,
    found: check.value,
    fix: fixes[check.label],
  };
}

export default function StartupGuardWrapper({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [errors, setErrors] = useState<StartupError[]>([]);

  // Only run after mount to avoid SSR issues
  useEffect(() => {
    setMounted(true);

    fetch("/api/system/db-status")
      .then((res) => res.json())
      .then((data: DbStatusResponse) => {
        const failures = (data.checks || [])
          .filter((c) => c.status === "fail")
          .map(mapCheckToError);

        if (failures.length > 0) {
          setErrors(failures);
          setState("error");
        } else if (data.error && !data.checks?.length) {
          setErrors([{ kind: "pragma_error", message: data.error }]);
          setState("error");
        } else {
          setState("ok");
        }
      })
      .catch(() => {
        // API unreachable — don't block the app, just proceed
        setState("ok");
      });
  }, []);

  // During SSR, just render children
  if (!mounted) {
    return <>{children}</>;
  }

  // Show loading state only after mount
  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <span className="spinner w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (state === "error") {
    return <DatabaseConfigError errors={errors} />;
  }

  return <>{children}</>;
}