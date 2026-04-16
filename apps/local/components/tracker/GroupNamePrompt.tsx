"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

interface GroupNamePromptProps {
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function GroupNamePrompt({ onConfirm, onCancel }: GroupNamePromptProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = name.trim();
    onConfirm(trimmed || "Untitled");
  }, [name, onConfirm]);

  return (
    <div className="mx-4 my-2 flex items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 shadow-lg">
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Name this group..."
        className="min-w-0 flex-1 bg-transparent text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none"
      />
      <button
        type="button"
        className="rounded px-2 py-1 text-[10px] font-medium bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
        onClick={handleSubmit}
      >
        Create
      </button>
      <button
        type="button"
        className="rounded px-2 py-1 text-[10px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}
