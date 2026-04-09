"use client";

import { useCallback, useEffect, useRef } from "react";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  preview?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  preview,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Small delay so the animation plays before focus
      const t = setTimeout(() => confirmRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    },
    [onCancel]
  );

  if (!isOpen) return null;

  const isDanger = variant === "danger";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-md"
      style={{ animation: "confirm-overlay-in 200ms ease-out" }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md mx-4 bg-[var(--card-bg)] rounded-2xl border border-[var(--card-border)] shadow-2xl overflow-hidden"
        style={{ animation: "confirm-dialog-in 250ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
      >
        {/* Header with icon */}
        <div className="px-6 pt-6 pb-3">
          <div className="flex items-start gap-4">
            {isDanger && (
              <div className="flex-shrink-0 w-11 h-11 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-semibold text-[var(--foreground)]">{title}</h3>
              <p className="mt-1 text-[13px] text-[var(--muted-foreground)] leading-relaxed">{message}</p>
            </div>
          </div>
        </div>

        {/* Message preview */}
        {preview && (
          <div className="mx-6 mb-3 px-3 py-2.5 rounded-lg bg-[var(--muted)]/40 border border-[var(--card-border)]">
            <p className="text-[12px] text-[var(--muted-foreground)] line-clamp-3 leading-relaxed italic">
              &ldquo;{preview}&rdquo;
            </p>
          </div>
        )}

        {/* Divider */}
        <div className="mx-6 border-t border-[var(--card-border)]" />

        {/* Actions */}
        <div className="px-6 py-4 flex items-center justify-end gap-2.5">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/60 transition-all duration-150"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
              isDanger
                ? "bg-red-500 text-white hover:bg-red-600 active:scale-[0.97]"
                : "btn-primary active:scale-[0.97]"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes confirm-overlay-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes confirm-dialog-in {
          from {
            opacity: 0;
            transform: scale(0.9) translateY(10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
