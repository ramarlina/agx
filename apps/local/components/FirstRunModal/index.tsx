"use client";

import React, { useEffect, useRef, useState } from "react";
import { WorkspaceRootsList } from "@/components/WorkspaceRootsList";
import { ConsentToggle } from "@/components/ConsentToggle";
import type { UserPreferences } from "@/types/userPreferences";

export interface FirstRunModalProps {
  /** Whether the modal is visible */
  open: boolean;
  /** Current user preferences (used to initialise local state) */
  preferences: UserPreferences;
  /** Called with the updated preferences when the user saves */
  onSave: (patch: Partial<UserPreferences>) => void;
}

export const FirstRunModal: React.FC<FirstRunModalProps> = ({
  open,
  preferences,
  onSave,
}) => {
  const [roots, setRoots] = useState<string[]>(preferences.workspaceRoots);
  const [homeConsent, setHomeConsent] = useState(preferences.homeSearchConsent);
  // Track whether the user tried to save without any roots
  const [showRootsWarning, setShowRootsWarning] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = "first-run-modal-heading";
  const descId = "first-run-modal-desc";

  // Sync props → local state whenever the modal re-opens
  useEffect(() => {
    if (open) {
      setRoots(preferences.workspaceRoots);
      setHomeConsent(preferences.homeSearchConsent);
      setShowRootsWarning(false);
    }
  }, [open, preferences.workspaceRoots, preferences.homeSearchConsent]);

  // Focus trap: keep focus inside the dialog while it is open
  useEffect(() => {
    if (!open) return;

    const el = dialogRef.current;
    if (!el) return;

    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // Move focus into the modal
    first?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const handleSave = () => {
    if (roots.length === 0) {
      setShowRootsWarning(true);
      return;
    }
    onSave({
      workspaceRoots: roots,
      homeSearchConsent: homeConsent,
      hasCompletedFirstRun: true,
    });
  };

  const handleSkip = () => {
    onSave({
      workspaceRoots: roots,
      homeSearchConsent: homeConsent,
      hasCompletedFirstRun: true,
    });
  };

  if (!open) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-2 sm:p-4"
      aria-hidden="false"
    >
      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descId}
        className="relative w-full max-w-lg rounded-xl bg-[var(--card-bg)] shadow-xl ring-1 ring-[var(--border)] flex flex-col max-h-[90vh] min-w-0"
      >
        {/* Header */}
        <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-4 border-b border-[var(--border)]">
          <h2
            id={headingId}
            className="text-lg font-semibold text-[var(--foreground)] leading-snug"
          >
            Set up your workspace
          </h2>
          <p
            id={descId}
            className="mt-1 text-sm text-[var(--muted-foreground)] leading-relaxed"
          >
            Add one or more folders where you keep your projects. agx-chat will
            use these to suggest files when you type{" "}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-xs font-mono text-[var(--foreground)]">
              @filename
            </code>
            .
          </p>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 flex flex-col gap-6">
          {/* Workspace roots */}
          <section aria-labelledby="first-run-roots-heading">
            <h3
              id="first-run-roots-heading"
              className="text-sm font-semibold text-[var(--foreground)] mb-3"
            >
              Workspace folders
            </h3>
            <WorkspaceRootsList
              roots={roots}
              onAdd={(path) => {
                setRoots((prev) =>
                  prev.includes(path) ? prev : [...prev, path]
                );
                setShowRootsWarning(false);
              }}
              onRemove={(path) =>
                setRoots((prev) => prev.filter((r) => r !== path))
              }
            />
            {showRootsWarning && (
              <p
                role="alert"
                className="mt-2 text-xs text-red-600 font-medium"
              >
                Please add at least one workspace folder to continue.
              </p>
            )}
          </section>

          {/* Home search consent */}
          <section
            aria-labelledby="first-run-consent-heading"
            className="border-t border-[var(--border)] pt-5"
          >
            <h3
              id="first-run-consent-heading"
              className="text-sm font-semibold text-[var(--foreground)] mb-3"
            >
              Home directory search
            </h3>
            <ConsentToggle
              id="first-run-home-consent"
              checked={homeConsent}
              onChange={setHomeConsent}
            />
          </section>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-4 border-t border-[var(--border)] flex flex-col-reverse sm:flex-row justify-between gap-3">
          <button
            type="button"
            onClick={handleSkip}
            className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border)] rounded"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex justify-center items-center rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 active:scale-95 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50"
          >
            Save &amp; continue
          </button>
        </div>
      </div>
    </div>
  );
};

export default FirstRunModal;
